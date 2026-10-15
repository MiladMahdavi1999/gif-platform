import { readApiConfig } from '@gif/config';
import { createDatabaseProbe } from '@gif/db';
import { checkObjectStore } from '@gif/storage';
import { createApp } from './app.js';

async function main() {
  const config = readApiConfig(process.env);
  const database = createDatabaseProbe(config.DATABASE_URL);
  const app = createApp(
    {
      database: database.check,
      storage: () => checkObjectStore(config.S3_INTERNAL_ENDPOINT),
    },
    true,
  );
  app.addHook('onClose', database.close);
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
