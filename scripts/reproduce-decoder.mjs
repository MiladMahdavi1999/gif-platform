// Build packages and worker first. Uses the production spawn, sandbox marker,
// metadata comparison and output checks; never invokes a shell or reads user media.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { animatedGif } from '../packages/testing/dist/index.js';
import { readWorkerConfig } from '../packages/config/dist/index.js';
import { renderGif, DecoderFault } from '../apps/worker/dist/decoder.js';
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
const directory = await mkdtemp(join(tmpdir(), 'gif-repro-'));
try {
  const bytes = animatedGif({ width: 165, height: 293, frameCount: 93 });
  const path = join(directory, 'input.gif');
  await writeFile(path, bytes);
  const outputs = await renderGif(path, config, new AbortController().signal);
  console.log(
    JSON.stringify({
      inputBytes: bytes.length,
      outputs: outputs.map(({ bytes, ...metadata }) => ({
        ...metadata,
        sizeBytes: bytes.length,
      })),
    }),
  );
} catch (error) {
  if (error instanceof DecoderFault)
    console.error(JSON.stringify({ stage: error.stage, code: error.code }));
  else console.error('Decoder reproduction failed');
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
