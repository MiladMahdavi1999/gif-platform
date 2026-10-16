import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import { LoginLimiter } from '../../../apps/api/src/auth.js';
import { createAuthRepository } from './auth.js';
import { createUploadRepository, createPublicRepository } from '@gif/db';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase, seedDevelopment } from './dev.js';
import { animatedGif } from '@gif/testing';
import {
  createUploadStorage,
  createPublicStorage,
  provisionPrivateStorage,
  s3Client,
  type StorageConfig,
} from '@gif/storage';
import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';

if (
  process.env.NODE_ENV === 'production' ||
  process.env.APP_ENV === 'production' ||
  process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true' ||
  process.env.ALLOW_STORAGE_INTEGRATION_TESTS !== 'true'
)
  throw new Error(
    'Explicit local database AND storage integration opt-in required',
  );
const source = new URL(process.env.TEST_DATABASE_URL ?? '');
assertDevelopmentDatabase({
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: source.href,
});
if (!source.pathname.endsWith('_test'))
  throw new Error('Integration database must end in _test');
const suffix = randomUUID().replaceAll('-', '');
const name = `gif_platform_b03_${suffix}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const config: StorageConfig = {
  S3_INTERNAL_ENDPOINT:
    process.env.TEST_S3_INTERNAL_ENDPOINT ?? 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT:
    process.env.TEST_S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID!,
  S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY!,
  S3_QUARANTINE_BUCKET: `gif-b03-${suffix}`,
  S3_DERIVATIVES_BUCKET: `gif-b03-out-${suffix}`,
  MAX_GIF_UPLOAD_BYTES: 1024,
};
if (
  !config.S3_ACCESS_KEY_ID ||
  !config.S3_SECRET_ACCESS_KEY ||
  !['localhost', '127.0.0.1', 'minio'].includes(
    new URL(config.S3_INTERNAL_ENDPOINT).hostname,
  ) ||
  !['localhost', '127.0.0.1'].includes(
    new URL(config.S3_PUBLIC_ENDPOINT).hostname,
  )
)
  throw new Error('Explicit local MinIO credentials and endpoints required');
const admin = new pg.Pool({ connectionString: source.href });
const pool = new pg.Pool({ connectionString: target.href });
const auth = createAuthRepository(target.href);
const uploads = createUploadRepository(target.href);
const storage = createUploadStorage(config);
const s3 = s3Client(config);
const origin = 'http://localhost:8080';
const password = randomBytes(24).toString('base64url');
const publicRead = createPublicRepository(
  target.href,
  'regression_public_cursor_key_at_least_32_bytes',
);
const publicStorage = createPublicStorage(config);
const app = createApp(
  { database: async () => {}, storage: async () => {} },
  false,
  {
    repository: auth.repository,
    origin,
    cookieName: 'gif_session',
    ttlSeconds: 86400,
    secure: false,
    limiter: new LoginLimiter(200, 400),
  },
  {
    repository: uploads.repository,
    storage: storage.storage,
    ttlSeconds: 600,
    maxBytes: config.MAX_GIF_UPLOAD_BYTES,
  },
  undefined,
  {
    repository: publicRead.repository,
    storage: publicStorage,
    cacheSeconds: 30,
  },
);
let created = false;
let uploader: { cookie: string; csrf: string };
let other: typeof uploader;
let reviewer: typeof uploader;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const client = await pool.connect();
  try {
    await migrate(client);
    await seedDevelopment(client, {
      NODE_ENV: 'development',
      APP_ENV: 'development',
      ALLOW_DEV_DATABASE_COMMANDS: 'true',
      DATABASE_URL: target.href,
      DEV_UPLOADER_EMAIL: 'uploader@local.test',
      DEV_UPLOADER_PASSWORD: password,
      DEV_REVIEWER_EMAIL: 'reviewer@local.test',
      DEV_REVIEWER_PASSWORD: password,
    });
  } finally {
    client.release();
  }
  // A second independent uploader; distinct from the reviewer identity.
  const user = (
    await pool.query(
      "INSERT INTO users(email,password_hash) SELECT 'other@local.test',password_hash FROM users WHERE email='uploader@local.test' RETURNING id",
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO role_grants(user_id,role) VALUES($1,'UPLOADER')",
    [user.id],
  );
  await provisionPrivateStorage(config);
  await app.ready();
  uploader = await login('uploader@local.test');
  other = await login('other@local.test');
  reviewer = await login('reviewer@local.test');
});
afterAll(async () => {
  await app.close();
  await publicRead.close();
  publicStorage.close();
  await auth.close();
  await uploads.close();
  storage.close();
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
  for (const Bucket of [
    config.S3_QUARANTINE_BUCKET,
    config.S3_DERIVATIVES_BUCKET,
  ]) {
    // Only the random buckets created by this test; remove all versions.
    const listed = await s3.send(new ListObjectVersionsCommand({ Bucket }));
    const objects = [
      ...(listed.Versions ?? []),
      ...(listed.DeleteMarkers ?? []),
    ].map((v) => ({ Key: v.Key!, VersionId: v.VersionId! }));
    if (objects.length)
      await s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects } }),
      );
    await s3.send(new DeleteBucketCommand({ Bucket }));
  }
  s3.destroy();
});
async function login(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  if (response.statusCode !== 200)
    throw new Error('Integration sign-in failed');
  return {
    cookie: `gif_session=${response.cookies[0]!.value}`,
    csrf: response.json().csrfToken as string,
  };
}
const body = (extra: Record<string, unknown> = {}) => ({
  kind: 'GIF',
  title: 'Original red blue loop',
  tags: ['original', 'آزمایش'],
  rightsAttested: true,
  rightsAttestationVersion: 'v1',
  claimedSizeBytes: animatedGif().length,
  ...extra,
});
function headers(account = uploader) {
  return { origin, cookie: account.cookie, 'x-csrf-token': account.csrf };
}
async function intent(
  extra: Record<string, unknown> = {},
  key = randomUUID(),
  account = uploader,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/uploads',
    headers: { ...headers(account), 'idempotency-key': key },
    payload: body(extra),
  });
}
async function fresh(extra: Record<string, unknown> = {}) {
  const response = await intent(extra);
  expect(response.statusCode).toBe(201);
  return response.json();
}
async function post(
  form: { url: string; fields: Record<string, string> },
  bytes = animatedGif(),
  fields: Record<string, string> = {},
) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...form.fields, ...fields }))
    data.append(key, value);
  data.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'image/gif' }),
    'original.gif',
  );
  return fetch(form.url, { method: 'POST', body: data });
}
function complete(uploadId: string, account = uploader) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/uploads/${uploadId}/complete`,
    headers: headers(account),
    payload: {},
  });
}
function detail(assetId: string, account = uploader) {
  return app.inject({
    url: `/api/v1/me/assets/${assetId}`,
    headers: { cookie: account.cookie },
  });
}
async function counts(assetId: string) {
  return (
    await pool.query(
      `SELECT (SELECT count(*) FROM media_jobs WHERE asset_id=$1)::int AS jobs,(SELECT count(*) FROM audit_events WHERE asset_id=$1 AND event_type='UPLOAD_RECEIVED')::int AS audits`,
      [assetId],
    )
  ).rows[0];
}

describe('B03 real PostgreSQL + MinIO private upload', () => {
  it('uploads an original animated GIF by signed POST to localhost:9000, HEAD verifies and persists a private receipt and READY job', async () => {
    const value = await fresh();
    expect(new URL(value.form.url).host).toBe('localhost:9000');
    expect((await post(value.form)).status).toBe(204);
    const receipt = await complete(value.uploadId);
    expect(receipt.statusCode).toBe(202);
    expect(receipt.json()).toEqual({
      assetId: value.assetId,
      upload: 'RECEIVED',
      processing: 'QUEUED',
    });
    const state = (await detail(value.assetId)).json();
    expect(state.states).toEqual({
      upload: 'RECEIVED',
      processing: 'QUEUED',
      visibility: 'PRIVATE',
      searchEligibility: 'INELIGIBLE',
      indexing: 'NOT_INDEXED',
      apiAvailability: 'BLOCKED',
      deliveryReadiness: 'NOT_READY',
      moderation: 'NOT_REQUESTED',
    });
    expect(state.variantsReady).toBe(false);
    expect(state.tags).toEqual(['original', 'آزمایش']);
    const stored = (
      await pool.query('SELECT * FROM upload_sessions WHERE id=$1', [
        value.uploadId,
      ])
    ).rows[0];
    expect(Number(stored.received_size_bytes)).toBe(animatedGif().length);
    expect(Boolean(stored.received_etag)).toBe(true);
    expect(Boolean(stored.received_version_id)).toBe(true);
    const original = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_QUARANTINE_BUCKET,
        Key: stored.quarantine_key,
        VersionId: stored.received_version_id,
      }),
    );
    expect(
      Buffer.from(await original.Body!.transformToByteArray()).equals(
        animatedGif(),
      ),
    ).toBe(true);
    expect(await counts(value.assetId)).toEqual({ jobs: 1, audits: 1 });
    expect(
      (
        await pool.query(
          'SELECT status,attempt_count FROM media_jobs WHERE asset_id=$1',
          [value.assetId],
        )
      ).rows[0],
    ).toEqual({ status: 'READY', attempt_count: 0 });
    // New repository connection proves receipt is not process-local state.
    const restarted = createUploadRepository(target.href);
    try {
      const id = (
        await pool.query(
          "SELECT id FROM users WHERE email='uploader@local.test'",
        )
      ).rows[0].id;
      expect(
        (await restarted.repository.detail(id, value.assetId))?.states.upload,
      ).toBe('RECEIVED');
    } finally {
      await restarted.close();
    }
  });
  it('serializes concurrent/repeated intent and completion, rejects changed metadata, preserves exact version after signed-form replay', async () => {
    const key = randomUUID();
    const responses = await Promise.all([intent({}, key), intent({}, key)]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    const value = responses[0]!.json();
    expect(responses[1]!.json().assetId).toBe(value.assetId);
    expect((await intent({ title: 'Different' }, key)).statusCode).toBe(409);
    expect((await post(value.form)).status).toBe(204);
    const receipts = await Promise.all([
      complete(value.uploadId),
      complete(value.uploadId),
    ]);
    expect(receipts.map((r) => r.statusCode)).toEqual([202, 202]);
    expect(await counts(value.assetId)).toEqual({ jobs: 1, audits: 1 });
    const before = (
      await pool.query(
        'SELECT received_version_id FROM upload_sessions WHERE id=$1',
        [value.uploadId],
      )
    ).rows[0].received_version_id;
    expect(
      (await post(value.form, Buffer.from('replacement bytes'))).status,
    ).toBe(204);
    expect((await complete(value.uploadId)).statusCode).toBe(202);
    expect(
      (
        await pool.query(
          'SELECT received_version_id FROM upload_sessions WHERE id=$1',
          [value.uploadId],
        )
      ).rows[0].received_version_id,
    ).toBe(before);
    const original = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_QUARANTINE_BUCKET,
        Key: value.form.fields.key,
        VersionId: before,
      }),
    );
    expect(
      Buffer.from(await original.Body!.transformToByteArray()).equals(
        animatedGif(),
      ),
    ).toBe(true);
    await pool.query(
      "UPDATE upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [value.uploadId],
    );
    expect((await complete(value.uploadId)).statusCode).toBe(202);
    expect((await intent({}, key)).json().error.code).toBe(
      'UPLOAD_INTENT_EXPIRED',
    );
  });
  it('persists expired sessions, refuses stale intent and completion without a job, and enforces actual signed policy expiry', async () => {
    const key = randomUUID();
    const response = await intent({}, key);
    const value = response.json();
    await pool.query(
      "UPDATE upload_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [value.uploadId],
    );
    const expired = await complete(value.uploadId);
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('UPLOAD_INTENT_EXPIRED');
    expect((await intent({}, key)).statusCode).toBe(409);
    expect((await detail(value.assetId)).json().states.upload).toBe('EXPIRED');
    expect(await counts(value.assetId)).toEqual({ jobs: 0, audits: 0 });
    const signed = await storage.storage.sign(
      `quarantine/expiry-${randomUUID()}.gif`,
      new Date(Date.now() + 2100),
    );
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect((await post(signed)).status).toBe(403);
  });
  it('refuses missing files; compares actual HEAD size, MIME and configured size ceiling', async () => {
    const missing = await fresh();
    expect((await complete(missing.uploadId)).json().error.code).toBe(
      'UPLOAD_OBJECT_MISSING',
    );
    for (const [data, type, code, status] of [
      [animatedGif(), 'text/plain', 'UPLOAD_MIME_MISMATCH', 409],
      [Buffer.from('short'), 'image/gif', 'UPLOAD_SIZE_MISMATCH', 409],
      [Buffer.alloc(1025), 'image/gif', 'UPLOAD_TOO_LARGE', 413],
    ] as const) {
      const value = await fresh();
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_QUARANTINE_BUCKET,
          Key: value.form.fields.key,
          Body: data,
          ContentType: type,
        }),
      );
      const result = await complete(value.uploadId);
      expect(result.statusCode).toBe(status);
      expect(result.json().error.code).toBe(code);
      expect(await counts(value.assetId)).toEqual({ jobs: 0, audits: 0 });
    }
    expect((await intent({ claimedSizeBytes: 1025 })).statusCode).toBe(413);
  });
  it('enforces signed POST exact key, GIF MIME, maximum size, and rejects public ACL additions', async () => {
    const value = await fresh();
    for (const [data, fields] of [
      [animatedGif(), { 'Content-Type': 'text/plain' }],
      [animatedGif(), { key: 'quarantine/tampered.gif' }],
      [animatedGif(), { acl: 'public-read' }],
      [Buffer.alloc(1025), {}],
    ] as const) {
      expect((await post(value.form, data, fields)).ok).toBe(false);
    }
    expect((await complete(value.uploadId)).json().error.code).toBe(
      'UPLOAD_OBJECT_MISSING',
    );
  });
  it('enforces authentication, role, CSRF, Origin, strict bodies and owner boundaries for receipt/list/completion', async () => {
    const value = await fresh();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/uploads',
          headers: { origin },
          payload: body(),
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject('/api/v1/me/assets')).statusCode).toBe(401);
    expect(
      (await app.inject(`/api/v1/me/assets/${value.assetId}`)).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/uploads/${value.uploadId}/complete`,
          headers: { origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect((await intent({}, randomUUID(), reviewer)).statusCode).toBe(403);
    expect((await complete(value.uploadId, other)).statusCode).toBe(404);
    expect((await detail(value.assetId, other)).statusCode).toBe(404);
    expect((await detail(value.assetId, reviewer)).statusCode).toBe(404);
    const list = await app.inject({
      url: '/api/v1/me/assets',
      headers: { cookie: other.cookie },
    });
    expect(list.json().items).toEqual([]);
    for (const patch of [
      { 'x-csrf-token': 'forged' },
      { origin: 'https://evil.test' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/uploads',
            headers: {
              ...headers(),
              ...patch,
              'idempotency-key': randomUUID(),
            },
            payload: body(),
          })
        ).statusCode,
      ).toBe(403);
    expect((await intent({ key: 'user-path' })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/uploads/${value.uploadId}/complete`,
          headers: headers(),
          payload: { key: 'user-path' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/api/v1/me/assets?cursor=invalid',
          headers: { cookie: uploader.cookie },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('denies anonymous original/version/bucket reads, leaves both buckets private, exposes no secret or public media/search', async () => {
    const value = await fresh();
    await post(value.form);
    await complete(value.uploadId);
    const version = (
      await pool.query(
        'SELECT received_version_id FROM upload_sessions WHERE id=$1',
        [value.uploadId],
      )
    ).rows[0].received_version_id;
    const url = `${config.S3_PUBLIC_ENDPOINT}/${config.S3_QUARANTINE_BUCKET}/${value.form.fields.key}`;
    for (const target of [
      url,
      `${url}?versionId=${encodeURIComponent(version)}`,
      `${config.S3_PUBLIC_ENDPOINT}/${config.S3_QUARANTINE_BUCKET}?list-type=2`,
    ])
      expect((await fetch(target)).status).toBe(403);
    for (const Bucket of [
      config.S3_QUARANTINE_BUCKET,
      config.S3_DERIVATIVES_BUCKET,
    ]) {
      await expect(
        s3.send(new GetBucketPolicyCommand({ Bucket })),
      ).rejects.toMatchObject({ name: 'NoSuchBucketPolicy' });
    }
    expect(
      (
        await s3.send(
          new GetBucketVersioningCommand({
            Bucket: config.S3_QUARANTINE_BUCKET,
          }),
        )
      ).Status,
    ).toBe('Enabled');
    const receipt = await detail(value.assetId);
    for (const sensitive of [
      config.S3_SECRET_ACCESS_KEY,
      config.S3_ACCESS_KEY_ID,
      value.form.fields.key,
      version,
    ])
      expect(receipt.body.includes(sensitive)).toBe(false);
    expect(JSON.stringify(value).includes(config.S3_SECRET_ACCESS_KEY)).toBe(
      false,
    );
    const publicList = await app.inject('/api/v1/public/gifs');
    expect(publicList.statusCode).toBe(200);
    expect(
      publicList
        .json()
        .items.some((item: { id: string }) => item.id === value.assetId),
    ).toBe(false);
    for (const path of [
      `/api/v1/public/gifs/${value.assetId}`,
      `/media/${value.assetId}/display.gif`,
      `/media/${value.assetId}/original.gif`,
    ])
      expect((await app.inject(path)).statusCode).toBe(404);
    expect(
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM search_documents)::int AS search,(SELECT count(*) FROM asset_variants)::int AS variants,(SELECT count(*) FROM moderation_decisions)::int AS decisions',
        )
      ).rows[0],
    ).toEqual({ search: 0, variants: 0, decisions: 0 });
  });
  it('allows only the configured browser origin in MinIO CORS preflight', async () => {
    const url = `${config.S3_PUBLIC_ENDPOINT}/${config.S3_QUARANTINE_BUCKET}`;
    const allowed = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
    const denied = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.test',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('rolls back receipt/states/job if the transactional audit insert fails', async () => {
    const value = await fresh();
    await post(value.form);
    await pool.query(
      "CREATE FUNCTION b03_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER b03_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION b03_fail_audit()',
    );
    try {
      expect((await complete(value.uploadId)).statusCode).toBe(503);
      expect(await counts(value.assetId)).toEqual({ jobs: 0, audits: 0 });
      expect((await detail(value.assetId)).json().states).toMatchObject({
        upload: 'INTENT',
        processing: 'NOT_STARTED',
      });
      expect(
        (
          await pool.query(
            'SELECT completed_at FROM upload_sessions WHERE id=$1',
            [value.uploadId],
          )
        ).rows[0].completed_at,
      ).toBeNull();
    } finally {
      await pool.query('DROP TRIGGER b03_fail_audit ON audit_events');
      await pool.query('DROP FUNCTION b03_fail_audit()');
    }
    expect((await complete(value.uploadId)).statusCode).toBe(202);
  });
});
