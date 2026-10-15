import { writeFileSync, rmSync } from 'node:fs';
import { readWorkerConfig } from '@gif/config';

try {
  readWorkerConfig(process.env);
  const heartbeat = '/tmp/gif-worker-heartbeat';
  const tick = () => writeFileSync(heartbeat, String(Date.now()));
  tick();
  const interval = setInterval(tick, 5000);
  console.log(
    JSON.stringify({
      service: 'worker',
      status: 'idle',
      message: 'No media jobs implemented in B00',
    }),
  );
  const shutdown = () => {
    clearInterval(interval);
    rmSync(heartbeat, { force: true });
    console.log(JSON.stringify({ service: 'worker', status: 'stopped' }));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  console.error('Worker startup failed');
  process.exitCode = 1;
}
