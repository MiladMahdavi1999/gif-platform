import { execFileSync } from 'node:child_process';
execFileSync(
  'cc',
  [
    '-shared',
    '-fPIC',
    '-O2',
    '-Wall',
    '-Werror',
    '-o',
    'infra/decoder/sandbox.so',
    'infra/decoder/sandbox.c',
  ],
  { stdio: 'inherit' },
);
import { mkdirSync } from 'node:fs';
mkdirSync('work', { recursive: true });
execFileSync(
  'cc',
  [
    '-O2',
    '-Wall',
    '-Werror',
    '-o',
    'work/decoder-probe',
    'infra/decoder/probe.c',
  ],
  { stdio: 'inherit' },
);
