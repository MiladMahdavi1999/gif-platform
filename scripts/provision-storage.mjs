import { readApiConfig } from '../packages/config/dist/index.js';
import { provisionPrivateStorage } from '../packages/storage/dist/index.js';
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (
  process.env.NODE_ENV !== 'development' ||
  process.env.APP_ENV !== 'development' ||
  process.env.ALLOW_DEV_DATABASE_COMMANDS !== 'true'
)
  throw new Error(
    'Private local storage provisioning requires explicit development opt-in',
  );
try {
  await provisionPrivateStorage(readApiConfig(process.env));
  console.log(
    'Private quarantine and derivative buckets provisioned; quarantine versioning enabled.',
  );
} catch {
  console.error(
    'Private storage provisioning failed. Check local endpoint and server credentials.',
  );
  process.exitCode = 1;
}
