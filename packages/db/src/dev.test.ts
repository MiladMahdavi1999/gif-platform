import { expect, it } from 'vitest';
import { assertDevelopmentDatabase } from './dev.js';
const valid = {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: 'postgresql://local@localhost/gif_platform',
};
it('requires explicit development mode, opt-in and a local target', () => {
  expect(assertDevelopmentDatabase(valid)).toBe('gif_platform');
  for (const patch of [
    { NODE_ENV: 'production' },
    { NODE_ENV: undefined },
    { NODE_ENV: 'test' },
    { APP_ENV: 'production' },
    { APP_ENV: undefined },
    { ALLOW_DEV_DATABASE_COMMANDS: undefined },
    { DATABASE_URL: 'postgresql://local@production.example/gif_platform' },
    { DATABASE_URL: 'postgresql://local@localhost/production' },
    { DATABASE_URL: '' },
  ])
    expect(() => assertDevelopmentDatabase({ ...valid, ...patch })).toThrow();
});

it('blocks every destructive entry point in production before invoking Docker', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const argv of [
    ['scripts/database-command.mjs', 'seed'],
    ['scripts/database-command.mjs', 'reset', '--confirm=gif_platform'],
    ['scripts/test-local-lifecycle.mjs', '--confirm=gif_platform'],
  ]) {
    const result = spawnSync(process.execPath, argv, {
      encoding: 'utf8',
      env: { ...process.env, ...valid, NODE_ENV: 'production' },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Development command|Development commands/);
  }
});
