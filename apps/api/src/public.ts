import type { FastifyInstance } from 'fastify';
import { assetIdSchema, publicQuerySchema } from '@gif/contracts';
import { PublicFault, type PublicRepository } from '@gif/db';
import { PublicMediaFault, type PublicStorage } from '@gif/storage';
import { fail } from './auth.js';
import { PublicLimiter } from './public-limits.js';
export interface PublicOptions {
  repository: PublicRepository;
  storage: PublicStorage;
  cacheSeconds: number;
  readLimitPerMinute?: number;
  mediaLimitPerMinute?: number;
  maxConcurrentMedia?: number;
}
export async function installPublic(
  app: FastifyInstance,
  {
    repository,
    storage,
    cacheSeconds,
    readLimitPerMinute = 300,
    mediaLimitPerMinute = 600,
    maxConcurrentMedia = 5,
  }: PublicOptions,
) {
  // These explicit local defaults are provisional guardrails, not production capacity.
  const reads = new PublicLimiter(readLimitPerMinute);
  const media = new PublicLimiter(mediaLimitPerMinute);
  let activeMedia = 0;
  app.addHook('onRequest', async (request, reply) => {
    const limiter = request.routeOptions.url?.startsWith('/media/')
      ? media
      : reads;
    const retry = limiter.consume(request.ip);
    if (retry) {
      reply.header('Retry-After', retry);
      return fail(
        request,
        reply,
        429,
        'RATE_LIMITED',
        'Too many requests. Please retry later.',
      );
    }
  });
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
      if (activeMedia >= maxConcurrentMedia) {
        reply.header('Retry-After', 1);
        return fail(
          request,
          reply,
          503,
          'MEDIA_BUSY',
          'Media service busy. Please retry.',
        );
      }
      activeMedia++;
      try {
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
      } finally {
        activeMedia--;
      }
    },
  );
}
