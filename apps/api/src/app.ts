import Fastify, { LogController } from 'fastify';
import { installAuth, type AuthOptions } from './auth.js';
import type { Readiness } from '@gif/contracts';

export interface HealthDependencies {
  database: () => Promise<void>;
  storage: () => Promise<void>;
}

export function createApp(
  dependencies: HealthDependencies,
  logging = false,
  auth?: AuthOptions,
) {
  const app = Fastify({
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
    reply.header('Cache-Control', 'no-store');
  });

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

  if (auth)
    app.register(async (instance) => {
      await installAuth(instance, auth);
    });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    const invalid = status === 400 || status === 413 || status === 415;
    reply.code(invalid ? status : 500).send({
      error: {
        code: invalid ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: invalid ? 'Invalid request' : 'Request failed',
        requestId: request.id,
      },
    });
  });

  return app;
}
