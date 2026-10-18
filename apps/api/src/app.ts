import { installPublic, type PublicOptions } from './public.js';
import Fastify, { LogController } from 'fastify';
import { installAuth, type AuthOptions } from './auth.js';
import type { Readiness } from '@gif/contracts';
import { installUploads, type UploadOptions } from './uploads.js';
import { installReview, type ReviewOptions } from './review.js';
import { randomUUID } from 'node:crypto';

export interface HealthDependencies {
  database: () => Promise<void>;
  storage: () => Promise<void>;
}

export function createApp(
  dependencies: HealthDependencies,
  logging = false,
  auth?: AuthOptions,
  uploads?: UploadOptions,
  review?: ReviewOptions,
  publicOptions?: PublicOptions,
) {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: logging
      ? {
          level: 'info',
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 5000,
    bodyLimit: 16384,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-ID', request.id);
    if (!reply.hasHeader('Cache-Control'))
      reply.header('Cache-Control', 'no-store');
  });
  // An allowlisted record: never serialize requests, URLs, bodies or raw errors.
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      event: 'request_completed',
      requestId: request.id,
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      classification:
        reply.statusCode >= 500
          ? 'service_unavailable'
          : reply.statusCode >= 400
            ? 'request_rejected'
            : 'completed',
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id },
    }),
  );

  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    const results = await Promise.allSettled([
      Promise.resolve().then(dependencies.database),
      Promise.resolve().then(dependencies.storage),
    ]);
    const database = results[0]?.status === 'fulfilled' ? 'up' : 'down';
    const storage = results[1]?.status === 'fulfilled' ? 'up' : 'down';
    const ready = database === 'up' && storage === 'up';
    const body: Readiness = {
      status: ready ? 'ready' : 'not_ready',
      checks: { database, storage },
    };
    return reply.code(ready ? 200 : 503).send(body);
  });

  if (publicOptions)
    app.register(async (instance) => installPublic(instance, publicOptions));

  if (auth)
    app.register(async (instance) => {
      await installAuth(instance, auth);
      if (review)
        await instance.register(async (reviewApp) =>
          installReview(reviewApp, review),
        );
      if (uploads)
        await instance.register(async (uploadApp) =>
          installUploads(uploadApp, uploads),
        );
    });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    const invalid = status === 400 || status === 413 || status === 415;
    reply.code(invalid ? status : 503).send({
      error: {
        code: invalid ? 'INVALID_REQUEST' : 'SERVICE_UNAVAILABLE',
        message: invalid
          ? 'Invalid request'
          : 'Service unavailable. Please retry.',
        requestId: request.id,
      },
    });
  });

  return app;
}
