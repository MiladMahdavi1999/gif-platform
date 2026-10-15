import Fastify, { LogController } from 'fastify';
import type { Readiness } from '@gif/contracts';

export interface HealthDependencies {
  database: () => Promise<void>;
  storage: () => Promise<void>;
}

export function createApp(dependencies: HealthDependencies, logging = false) {
  const app = Fastify({
    logger: logging
      ? {
          level: 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie'],
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

  app.setErrorHandler((_error, request, reply) => {
    reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Request failed',
        requestId: request.id,
      },
    });
  });

  return app;
}
