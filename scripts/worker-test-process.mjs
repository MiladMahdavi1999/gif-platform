// Process-level integration harness only. Never used by the worker entrypoint.
import { readWorkerConfig } from '../packages/config/dist/index.js';
import { createProcessingRepository } from '../packages/db/dist/index.js';
import { createProcessingStorage } from '../packages/storage/dist/index.js';
import { processJob } from '../apps/worker/dist/process-job.js';
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_STORAGE_INTEGRATION_TESTS !== 'true'
)
  throw new Error('Local integration opt-in required');
const config = readWorkerConfig(process.env);
const repository = createProcessingRepository(
  config.DATABASE_URL,
  config.MEDIA_JOB_MAX_ATTEMPTS,
  config.MEDIA_JOB_LEASE_SECONDS,
);
const storage = createProcessingStorage(config);
try {
  const lease = await repository.claim();
  if (!lease) console.log('NO_JOB');
  else {
    console.log('CLAIMED');
    if (process.argv[2] !== 'claim') {
      const result = await processJob(
        lease,
        repository,
        storage,
        config,
        new AbortController().signal,
        process.argv[2] === 'crash-after-upload'
          ? async () => {
              console.log('UPLOADED');
              await new Promise(() => {});
            }
          : undefined,
      );
      console.log(result);
    }
  }
} catch {
  console.log('HARNESS_FAILED');
  process.exitCode = 1;
} finally {
  storage.close();
  await repository.close();
}
