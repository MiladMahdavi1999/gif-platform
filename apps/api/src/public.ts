import type { FastifyInstance } from 'fastify';
import { assetIdSchema, publicQuerySchema } from '@gif/contracts';
import { PublicFault, type PublicRepository } from '@gif/db';
import { PublicMediaFault, type PublicStorage } from '@gif/storage';
import { fail } from './auth.js';
export interface PublicOptions {
  repository: PublicRepository;
  storage: PublicStorage;
  cacheSeconds: number;
}
export async function installPublic(
  app: FastifyInstance,
  { repository, storage, cacheSeconds }: PublicOptions,
) {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex');
    if (reply.statusCode !== 200) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PublicFault || error instanceof PublicMediaFault)
      return fail(request, reply, error.status, error.code, error.message);
    return fail(
      request,
      reply,
      503,
      'PUBLIC_UNAVAILABLE',
      'Public service unavailable. Please retry.',
    );
  });
  app.get('/api/v1/public/gifs', async (request, reply) => {
    const query = publicQuerySchema.safeParse(request.query);
    if (!query.success)
      return fail(
        request,
        reply,
        400,
        'VALIDATION_ERROR',
        'Invalid search query',
      );
    return repository.list(query.data);
  });
  app.get<{ Params: { id: string } }>(
    '/api/v1/public/gifs/:id',
    async (request, reply) => {
      if (!assetIdSchema.safeParse(request.params.id).success)
        return fail(request, reply, 404, 'NOT_FOUND', 'GIF not found');
      return repository.detail(request.params.id);
    },
  );
  app.get<{ Params: { assetId: string; variant: string } }>(
    '/media/:assetId/:variant',
    async (request, reply) => {
      const { assetId, variant } = request.params;
      if (
        !assetIdSchema.safeParse(assetId).success ||
        (variant !== 'display.gif' && variant !== 'poster.png')
      )
        return fail(request, reply, 404, 'NOT_FOUND', 'GIF not found');
      const descriptor = await repository.media(assetId, variant, request.id);
      let bytes: Buffer;
      try {
        bytes = await storage.read(descriptor.value);
      } catch (error) {
        if (error instanceof PublicMediaFault && error.confirmed)
          await repository.degrade(assetId, descriptor.values, request.id);
        throw error;
      }
      // Storage may take time. A committed removal must also win at the response gate.
      await repository.authorize(assetId);
      return reply
        .header(
          'Cache-Control',
          `public, max-age=${cacheSeconds}, must-revalidate`,
        )
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Disposition', 'inline')
        .header('Content-Length', bytes.length)
        .header('ETag', `"sha256-${descriptor.value.sha256}"`)
        .type(descriptor.value.mimeType)
        .send(bytes);
    },
  );
}
