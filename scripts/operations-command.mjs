import { spawnSync } from 'node:child_process';
// Docker access is operator authority. No browser session/role is promoted.
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/compose.yaml',
    'exec',
    '-T',
    '-e',
    'ALLOW_INTERNAL_OPERATIONS=true',
    'api',
    'node',
    'scripts/operations.mjs',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
