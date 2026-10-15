import { loadEnvFile } from 'node:process';

export function requireDevelopment(confirmation) {
  try {
    loadEnvFile('.env');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.APP_ENV !== 'development' ||
    process.env.ALLOW_DEV_DATABASE_COMMANDS !== 'true'
  )
    throw new Error('Development commands are disabled');
  const target = new URL(process.env.DATABASE_URL ?? '');
  const database = decodeURIComponent(target.pathname.slice(1));
  if (
    target.search !== '' ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', 'db'].includes(target.hostname) ||
    !/^gif_platform(?:_[a-z0-9]+)*$/.test(database)
  )
    throw new Error('Development target refused');
  if (confirmation !== undefined && confirmation !== `--confirm=${database}`)
    throw new Error('Exact development reset confirmation is required');
}
