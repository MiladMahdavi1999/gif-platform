import type { FastifyInstance } from 'fastify';
import {
  assetIdSchema,
  completeRequestSchema,
  idempotencyKeySchema,
  uploadRequestSchema,
} from '@gif/contracts';
import { UploadFault, type UploadRepository } from '@gif/db';
import type { UploadStorage } from '@gif/storage';
import { fail, requireAuthentication, requireRole } from './auth.js';

export interface UploadOptions {
  repository: UploadRepository;
  storage: UploadStorage;
  ttlSeconds: number;
  maxBytes: number;
}
export async function installUploads(
  app: FastifyInstance,
  options: UploadOptions,
) {
  const { repository, storage } = options;
  // Only this plugin maps domain failures; storage exceptions never reach client/logs.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UploadFault) {
      if (error.status === 429) reply.header('Retry-After', 900);
      return fail(request, reply, error.status, error.code, error.message);
    }
    const status = (error as { statusCode?: number }).statusCode;
    return fail(
      request,
      reply,
      status === 400 || status === 413 || status === 415 ? status : 503,
      status && status < 500 ? 'INVALID_REQUEST' : 'UPLOAD_UNAVAILABLE',
      'Upload service unavailable or request invalid. Please retry.',
    );
  });
  app.post(
    '/api/v1/uploads',
    { preHandler: requireRole('UPLOADER') },
    async (request, reply) => {
      const input = uploadRequestSchema.safeParse(request.body);
      const key = idempotencyKeySchema.safeParse(
        request.headers['idempotency-key'],
      );
      if (!input.success || !key.success)
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Valid GIF metadata, rights attestation and upload key are required.',
        );
      if ((input.data.claimedSizeBytes ?? 0) > options.maxBytes)
        return fail(
          request,
          reply,
          413,
          'UPLOAD_TOO_LARGE',
          'File exceeds the upload size limit.',
        );
      const session = await repository.intent(
        request.authSession!.user.id,
        key.data,
        input.data,
        options.ttlSeconds,
      );
      const form = await storage.sign(session.key, session.expiresAt);
      return reply.code(201).send({
        assetId: session.assetId,
        uploadId: session.id,
        expiresAt: session.expiresAt.toISOString(),
        method: 'POST',
        form,
        state: { upload: session.upload, processing: session.processing },
      });
    },
  );
  app.post<{ Params: { uploadId: string } }>(
    '/api/v1/uploads/:uploadId/complete',
    { preHandler: requireRole('UPLOADER') },
    async (request, reply) => {
      if (
        !assetIdSchema.safeParse(request.params.uploadId).success ||
        !completeRequestSchema.safeParse(request.body).success
      )
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Valid upload ID and empty JSON object are required.',
        );
      const receipt = await repository.complete(
        request.authSession!.user.id,
        request.params.uploadId,
        request.id,
        options.maxBytes,
        storage.head,
      );
      return reply.code(202).send(receipt);
    },
  );
  app.get<{ Querystring: { cursor?: string } }>(
    '/api/v1/me/assets',
    { preHandler: requireAuthentication },
    async (request, reply) => {
      if (
        Object.keys(request.query).some((key) => key !== 'cursor') ||
        (request.query.cursor !== undefined &&
          !assetIdSchema.safeParse(request.query.cursor).success)
      )
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Invalid receipt cursor',
        );
      return repository.list(
        request.authSession!.user.id,
        request.query.cursor,
      );
    },
  );
  app.get<{ Params: { assetId: string } }>(
    '/api/v1/me/assets/:assetId',
    { preHandler: requireAuthentication },
    async (request, reply) => {
      if (!assetIdSchema.safeParse(request.params.assetId).success)
        return fail(request, reply, 404, 'NOT_FOUND', 'Receipt not found');
      const result = await repository.detail(
        request.authSession!.user.id,
        request.params.assetId,
      );
      return (
        result ?? fail(request, reply, 404, 'NOT_FOUND', 'Receipt not found')
      );
    },
  );
}
