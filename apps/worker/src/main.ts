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
const readiness = '/tmp/gif-worker-ready';
try {
  const config = readWorkerConfig(process.env);
  const repository = createProcessingRepository(
    config.DATABASE_URL,
    config.MEDIA_JOB_MAX_ATTEMPTS,
    config.MEDIA_JOB_LEASE_SECONDS,
  );
  const storage = createProcessingStorage(config);
  const tick = () => writeFileSync(health, String(Date.now()));
  let probing = false;
  const probe = async () => {
    if (probing) return;
    probing = true;
    try {
      await Promise.all([repository.check(), storage.check()]);
      if (!shutdown.signal.aborted)
        writeFileSync(readiness, String(Date.now()));
    } catch {
      rmSync(readiness, { force: true });
    } finally {
      probing = false;
    }
  };
  rmSync(readiness, { force: true });
  tick();
  const timer = setInterval(tick, 5000);
  const readyTimer = setInterval(() => void probe(), 5000);
  await probe();
  console.log(JSON.stringify({ service: 'worker', status: 'started' }));
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
          console.log(
            JSON.stringify({
              service: 'worker',
              status: result,
              jobId: lease.id,
              assetId: lease.assetId,
              attempt: lease.attempt,
            }),
          );
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
    clearInterval(readyTimer);
    rmSync(readiness, { force: true });
    rmSync(health, { force: true });
    storage.close();
    await repository.close();
  }
  console.log(JSON.stringify({ service: 'worker', status: 'stopped' }));
} catch {
  console.error('Worker startup failed');
  process.exitCode = 1;
}
