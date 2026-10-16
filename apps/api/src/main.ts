import { readApiConfig } from '@gif/config';
import {
  createAuthRepository,
  createDatabaseProbe,
  createUploadRepository,
  createReviewRepository,
} from '@gif/db';
import {
  checkObjectStore,
  checkUploadStorage,
  createUploadStorage,
  createReviewStorage,
} from '@gif/storage';
import { createApp } from './app.js';

async function main() {
  const config = readApiConfig(process.env);
  const database = createDatabaseProbe(config.DATABASE_URL);
  const auth = createAuthRepository(config.DATABASE_URL);
  const uploads = createUploadRepository(config.DATABASE_URL);
  const storage = createUploadStorage(config);
  const review = createReviewRepository(config.DATABASE_URL);
  const reviewStorage = createReviewStorage(config);
  const app = createApp(
    {
      database: database.check,
      storage: async () => {
        await checkObjectStore(config.S3_INTERNAL_ENDPOINT);
        await checkUploadStorage(config);
      },
    },
    true,
    {
      repository: auth.repository,
      origin: config.PUBLIC_BASE_URL,
      cookieName: config.SESSION_COOKIE_NAME,
      ttlSeconds: config.SESSION_TTL_SECONDS,
      secure: new URL(config.PUBLIC_BASE_URL).protocol === 'https:',
    },
    {
      repository: uploads.repository,
      storage: storage.storage,
      ttlSeconds: config.MEDIA_UPLOAD_POLICY_TTL_SECONDS,
      maxBytes: config.MAX_GIF_UPLOAD_BYTES,
    },
    { repository: review.repository, storage: reviewStorage },
  );
  app.addHook('onClose', database.close);
  app.addHook('onClose', auth.close);
  app.addHook('onClose', uploads.close);
  app.addHook('onClose', review.close);
  app.addHook('onClose', async () => reviewStorage.close());
  app.addHook('onClose', async () => storage.close());
  const shutdown = async () => {
    const deadline = setTimeout(() => process.exit(1), 8000);
    deadline.unref();
    try {
      await app.close();
      clearTimeout(deadline);
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  try {
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  } catch {
    await app.close();
    throw new Error('API startup failed');
  }
}

main().catch((error: unknown) => {
  // Config errors are sanitized at the config boundary. Never serialize raw errors.
  console.error(
    error instanceof Error &&
      error.message.startsWith('Invalid configuration fields:')
      ? error.message
      : 'API startup failed',
  );
  process.exitCode = 1;
});
