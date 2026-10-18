import { expect, it } from 'vitest';
import {
  createOpenApiDocument,
  readinessSchema,
  sessionResponseSchema,
} from '@gif/contracts';
import {
  createAuthRepository,
  createUploadRepository,
  createReviewRepository,
  createPublicRepository,
} from '@gif/db';
import {
  createUploadStorage,
  createReviewStorage,
  createPublicStorage,
} from '@gif/storage';
import { createApp } from './app.js';

it('matches every registered runtime operation, including implicit HEAD, to deterministic v1 contract', async () => {
  const url = 'postgresql://test:test@127.0.0.1:1/gif_platform_test';
  const auth = createAuthRepository(url),
    uploads = createUploadRepository(url),
    review = createReviewRepository(url),
    publicRead = createPublicRepository(url, 'x'.repeat(32));
  const config = {
    S3_INTERNAL_ENDPOINT: 'http://127.0.0.1:1',
    S3_PUBLIC_ENDPOINT: 'http://localhost:1',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test-only',
    S3_QUARANTINE_BUCKET: 'test-quarantine',
    S3_DERIVATIVES_BUCKET: 'test-derivatives',
    MAX_GIF_UPLOAD_BYTES: 1024,
    MAX_GIF_OUTPUT_BYTES: 1024,
  };
  const uploadStorage = createUploadStorage(config),
    reviewStorage = createReviewStorage(config),
    publicStorage = createPublicStorage(config);
  const routes: string[] = [];
  const app = createApp(
    { database: async () => {}, storage: async () => {} },
    false,
    {
      repository: auth.repository,
      origin: 'https://localhost',
      cookieName: 'gif_session',
      ttlSeconds: 60,
      secure: true,
    },
    {
      repository: uploads.repository,
      storage: uploadStorage.storage,
      ttlSeconds: 60,
      maxBytes: 1024,
    },
    { repository: review.repository, storage: reviewStorage },
    {
      repository: publicRead.repository,
      storage: publicStorage,
      cacheSeconds: 0,
    },
    (method, path) =>
      routes.push(`${method} ${path.replace(/:([A-Za-z]+)/g, '{$1}')}`),
  );
  try {
    await app.ready();
    const document = createOpenApiDocument();
    expect(JSON.stringify(document)).toBe(
      JSON.stringify(createOpenApiDocument()),
    );
    const documented = Object.entries(document.paths).flatMap(
      ([path, methods]) =>
        Object.keys(methods).flatMap((method) =>
          method === 'get'
            ? [`GET ${path}`, `HEAD ${path}`]
            : [`${method.toUpperCase()} ${path}`],
        ),
    );
    expect(routes.sort()).toEqual(documented.sort());
    const ready = await app.inject('/api/v1/health/ready');
    expect(readinessSchema.safeParse(ready.json()).success).toBe(true);
    const session = await app.inject('/api/v1/auth/session');
    expect(sessionResponseSchema.safeParse(session.json()).success).toBe(true);
    const failed = await app.inject({
      url: '/api/v1/auth/session',
      headers: { cookie: `gif_session=${'a'.repeat(43)}` },
    });
    expect(failed.statusCode).toBe(503);
    expect(document.paths['/api/v1/auth/session'].get.responses).toHaveProperty(
      '503',
    );
    expect(failed.json()).toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        requestId: failed.headers['x-request-id'],
      },
    });
    expect(failed.payload).not.toContain('postgresql');
  } finally {
    await app.close();
    await Promise.all([
      auth.close(),
      uploads.close(),
      review.close(),
      publicRead.close(),
    ]);
    uploadStorage.close();
    reviewStorage.close();
    publicStorage.close();
  }
});
