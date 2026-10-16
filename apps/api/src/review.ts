import type { FastifyInstance } from 'fastify';
import {
  assetIdSchema,
  decisionRequestSchema,
  removalRequestSchema,
  reviewQuerySchema,
} from '@gif/contracts';
import { ReviewFault, type ReviewRepository } from '@gif/db';
import { ReviewMediaFault, type ReviewStorage } from '@gif/storage';
import { fail, requireRole } from './auth.js';
export interface ReviewOptions {
  repository: ReviewRepository;
  storage: ReviewStorage;
}
export async function installReview(
  app: FastifyInstance,
  { repository, storage }: ReviewOptions,
) {
  app.addHook('preHandler', requireRole('REVIEWER'));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ReviewFault || error instanceof ReviewMediaFault)
      return fail(request, reply, error.status, error.code, error.message);
    const status = (error as { statusCode?: number }).statusCode;
    return fail(
      request,
      reply,
      status === 400 || status === 413 || status === 415 ? status : 503,
      status && status < 500 ? 'INVALID_REQUEST' : 'REVIEW_UNAVAILABLE',
      'Review request invalid or service unavailable. Please retry.',
    );
  });
  app.get('/api/v1/review/queue', async (request, reply) => {
    const input = reviewQuerySchema.safeParse(request.query);
    if (!input.success)
      return fail(
        request,
        reply,
        400,
        'VALIDATION_ERROR',
        'Invalid queue query',
      );
    return repository.queue(input.data.limit, input.data.cursor);
  });
  app.get<{ Params: { assetId: string } }>(
    '/api/v1/review/assets/:assetId',
    async (request, reply) => {
      if (!assetIdSchema.safeParse(request.params.assetId).success)
        return fail(request, reply, 404, 'NOT_FOUND', 'Review asset not found');
      return repository.detail(request.params.assetId);
    },
  );
  app.get<{ Params: { assetId: string; variant: string } }>(
    '/api/v1/review/assets/:assetId/media/:variant',
    async (request, reply) => {
      const { assetId, variant } = request.params;
      if (
        !assetIdSchema.safeParse(assetId).success ||
        !['DISPLAY_GIF', 'POSTER_PNG'].includes(variant)
      )
        return fail(request, reply, 404, 'NOT_FOUND', 'Preview not found');
      const value = await repository.preview(assetId, variant);
      const bytes = await storage.read(value);
      return reply
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Disposition', 'inline')
        .header('Content-Length', bytes.length)
        .type(value.mimeType)
        .send(bytes);
    },
  );
  app.post<{ Params: { assetId: string } }>(
    '/api/v1/review/assets/:assetId/decision',
    async (request, reply) => {
      const input = decisionRequestSchema.safeParse(request.body);
      if (
        !input.success ||
        !assetIdSchema.safeParse(request.params.assetId).success
      )
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Valid decision, reason and expectedVersion required',
        );
      return repository.decide(
        request.authSession!.user.id,
        request.params.assetId,
        input.data.decision,
        input.data,
        request.id,
        storage.verify,
      );
    },
  );
  app.post<{ Params: { assetId: string } }>(
    '/api/v1/review/assets/:assetId/remove',
    async (request, reply) => {
      const input = removalRequestSchema.safeParse(request.body);
      if (
        !input.success ||
        !assetIdSchema.safeParse(request.params.assetId).success
      )
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Valid reason and expectedVersion required',
        );
      return repository.decide(
        request.authSession!.user.id,
        request.params.assetId,
        'REMOVE',
        input.data,
        request.id,
        storage.verify,
      );
    },
  );
}
