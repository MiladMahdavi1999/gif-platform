import { spawnSync } from 'node:child_process';
import { requireDevelopment } from './require-development.mjs';

const command = process.argv[2];
if (!['migrate', 'seed', 'inspect', 'reset'].includes(command)) process.exit(1);
if (command !== 'migrate') {
  try {
    requireDevelopment(
      command === 'reset' ? (process.argv[3] ?? '') : undefined,
    );
  } catch {
    console.error(
      'Development command refused: check mode, local target and reset confirmation.',
    );
    process.exit(1);
  }
}
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/compose.yaml',
    '-f',
    'infra/compose.db-tools.yaml',
    'run',
    '--rm',
    'db-tools',
    'node',
    'packages/db/dist/cli.js',
    command,
    ...process.argv.slice(3),
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
