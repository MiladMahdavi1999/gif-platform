import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createReviewStorage } from './review.js';

it('aborts a private preview body that stalls after valid S3 response headers', async () => {
  const bytes = Buffer.from('GIF89a owned diagnostic bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': bytes.length,
      'x-amz-version-id': 'pinned-version',
      'x-amz-meta-sha256': sha256,
      'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64'),
    });
    response.write(bytes.subarray(0, 1)); // Intentionally no end: exercise body cancellation.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Local test server missing');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const storage = createReviewStorage({
    S3_INTERNAL_ENDPOINT: endpoint,
    S3_PUBLIC_ENDPOINT: endpoint,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'local_test_key',
    S3_SECRET_ACCESS_KEY: 'local_test_secret',
    S3_QUARANTINE_BUCKET: 'test-quarantine',
    S3_DERIVATIVES_BUCKET: 'test-derivatives',
    MAX_GIF_UPLOAD_BYTES: 1024,
  });
  try {
    await expect(
      storage.read({
        name: 'DISPLAY_GIF',
        objectKey: `assets/00000000-0000-4000-8000-000000000001/v1/${sha256}/display.gif`,
        objectVersionId: 'pinned-version',
        mimeType: 'image/gif',
        sizeBytes: bytes.length,
        sha256,
        frameCount: 2,
        generation: 1,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'REVIEW_MEDIA_UNAVAILABLE',
      message: 'Private preview unavailable',
    });
  } finally {
    storage.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 10000);
