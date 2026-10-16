import assert from 'node:assert/strict';
import { requireDevelopment } from './require-development.mjs';

requireDevelopment(process.argv[2] ?? '');
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Destructive reset of this repository's disposable development Compose project only.
const args = ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml'];
const compose = (...command) =>
  execFileSync('docker', [...args, ...command], { stdio: 'inherit' });
const capture = (...command) =>
  execFileSync('docker', [...args, ...command], { encoding: 'utf8' });

compose('stop', 'worker');
try {
  const worker = capture('ps', '--all', '--quiet', 'worker').trim();
  assert.ok(worker);
  const exitCode = execFileSync(
    'docker',
    ['inspect', '--format', '{{.State.ExitCode}}', worker],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(exitCode, '0');
  assert.match(capture('logs', '--no-color', 'worker'), /"status":"stopped"/);
  console.log('PASS: worker SIGTERM exits 0 and records graceful shutdown');
} finally {
  compose('start', 'worker');
}

const logs = capture('logs', '--no-color');
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
for (const key of [
  'POSTGRES_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_WORKER_ACCESS_KEY_ID',
  'S3_WORKER_SECRET_ACCESS_KEY',
  'DATABASE_URL',
  'WORKER_DATABASE_URL',
  'DEV_UPLOADER_PASSWORD',
  'DEV_REVIEWER_PASSWORD',
]) {
  assert.ok(env[key], `Missing local setting ${key}`);
  assert.ok(!logs.includes(env[key]), `Runtime logs contain ${key}`);
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/runtime.log', logs);
console.log('PASS: all six service logs exclude configured credentials/DB URL');

compose('down', '--volumes');
compose('up', '--wait', '--no-build');
await import('./smoke.mjs');
console.log(
  'PASS: fresh local volumes reboot all six services and readiness 200',
);
