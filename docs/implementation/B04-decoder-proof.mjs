// Run in the pinned worker image with --network none and the documented limits.
import { animatedGif } from './packages/testing/dist/index.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { readWorkerConfig } from './packages/config/dist/index.js';
import { renderGif } from './apps/worker/dist/decoder.js';
const config = readWorkerConfig({
  DATABASE_URL:
    'postgresql://fixture:fixture_password@localhost/gif_platform_test',
  PUBLIC_BASE_URL: 'http://localhost:8080',
  S3_INTERNAL_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'fixture_access_key',
  S3_SECRET_ACCESS_KEY: 'fixture_storage_password',
});
const directory = await mkdtemp('/tmp/gif-proof-');
try {
  await writeFile(`${directory}/input.gif`, animatedGif());
  const outputs = await renderGif(
    `${directory}/input.gif`,
    config,
    new AbortController().signal,
  );
  console.log(
    JSON.stringify(
      outputs.map(({ bytes, ...metadata }) => ({
        ...metadata,
        sizeBytes: bytes.length,
      })),
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
