import { writeFileSync, rmSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { readWorkerConfig } from '@gif/config';
import { createProcessingRepository } from '@gif/db';
import { createProcessingStorage } from '@gif/storage';
import { processJob } from './process-job.js';
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());
const health = '/tmp/gif-worker-heartbeat';
try {
  const config = readWorkerConfig(process.env);
  const repository = createProcessingRepository(
    config.DATABASE_URL,
    config.MEDIA_JOB_MAX_ATTEMPTS,
    config.MEDIA_JOB_LEASE_SECONDS,
  );
  const storage = createProcessingStorage(config);
  const tick = () => writeFileSync(health, String(Date.now()));
  tick();
  const timer = setInterval(tick, 5000);
  console.log(JSON.stringify({ service: 'worker', status: 'ready' }));
  try {
    while (!shutdown.signal.aborted) {
      try {
        const lease = await repository.claim();
        if (lease) {
          const result = await processJob(
            lease,
            repository,
            storage,
            config,
            shutdown.signal,
          );
          console.log(JSON.stringify({ service: 'worker', status: result }));
          continue;
        }
      } catch {
        console.log(
          JSON.stringify({
            service: 'worker',
            status: 'dependency_unavailable',
          }),
        );
      }
      await pause(config.MEDIA_JOB_POLL_INTERVAL_MS, undefined, {
        signal: shutdown.signal,
      }).catch(() => {});
    }
  } finally {
    clearInterval(timer);
    rmSync(health, { force: true });
    storage.close();
    await repository.close();
  }
  console.log(JSON.stringify({ service: 'worker', status: 'stopped' }));
} catch {
  console.error('Worker startup failed');
  process.exitCode = 1;
}
