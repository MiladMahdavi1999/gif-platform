import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import { LoginLimiter } from '../../../apps/api/src/auth.js';
import { createAuthRepository } from './auth.js';
import {
  createUploadRepository,
  createProcessingRepository,
  StaleLease,
  provisionDevelopmentWorker,
  type MediaLease,
} from '@gif/db';
import { createProcessingStorage } from '@gif/storage';
import { readWorkerConfig } from '@gif/config';
import { processJob } from '../../../apps/worker/src/process-job.js';
import { spawn, execFileSync } from 'node:child_process';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase, seedDevelopment } from './dev.js';
import { animatedGif } from '@gif/testing';
import {
  createUploadStorage,
  provisionPrivateStorage,
  s3Client,
  type StorageConfig,
} from '@gif/storage';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutBucketPolicyCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
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
const name = `gif_platform_b04_${suffix}_test`;
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
  S3_QUARANTINE_BUCKET: `gif-b04-${suffix}`,
  S3_DERIVATIVES_BUCKET: `gif-b04-out-${suffix}`,
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
const workerTarget = new URL(target);
workerTarget.username = 'gif_processing_worker';
workerTarget.password = 'local_only_b04_worker_password';
const processing = createProcessingRepository(workerTarget.href, 3, 3);
const workerStorageConfig = {
  ...config,
  S3_ACCESS_KEY_ID: `b04-worker-${suffix}`,
  S3_SECRET_ACCESS_KEY: randomBytes(24).toString('hex'),
};
const outputStorage = createProcessingStorage(workerStorageConfig);
const workerConfig = readWorkerConfig({
  ...workerStorageConfig,
  MAX_GIF_UPLOAD_BYTES: String(config.MAX_GIF_UPLOAD_BYTES),
  DATABASE_URL: workerTarget.href,
  PUBLIC_BASE_URL: 'http://localhost:8080',
  MEDIA_JOB_LEASE_SECONDS: '3',
} as unknown as NodeJS.ProcessEnv);
const origin = 'http://localhost:8080';
const password = randomBytes(24).toString('base64url');
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
);
let created = false;
let uploader: { cookie: string; csrf: string };
let other: typeof uploader;
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
  await provisionDevelopmentWorker({
    NODE_ENV: 'development',
    APP_ENV: 'development',
    ALLOW_DEV_DATABASE_COMMANDS: 'true',
    DATABASE_URL: target.href,
    WORKER_DATABASE_URL: workerTarget.href,
  });
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
  try {
    execFileSync(
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
        'APP_ENV=development',
        '-e',
        'ALLOW_DEV_DATABASE_COMMANDS=true',
        '-e',
        'S3_INTERNAL_ENDPOINT=http://localhost:9000',
        '-e',
        `S3_QUARANTINE_BUCKET=${config.S3_QUARANTINE_BUCKET}`,
        '-e',
        `S3_DERIVATIVES_BUCKET=${config.S3_DERIVATIVES_BUCKET}`,
        '-e',
        `S3_WORKER_ACCESS_KEY_ID=${workerStorageConfig.S3_ACCESS_KEY_ID}`,
        '-e',
        `S3_WORKER_SECRET_ACCESS_KEY=${workerStorageConfig.S3_SECRET_ACCESS_KEY}`,
        'minio',
        '/usr/local/bin/provision-worker',
      ],
      { stdio: 'pipe' },
    );
  } catch {
    throw new Error('Local test worker storage identity provisioning failed');
  }
  await app.ready();
  uploader = await login('uploader@local.test');
  other = await login('other@local.test');
});
afterAll(async () => {
  await app.close();
  await auth.close();
  await uploads.close();
  await processing.close();
  outputStorage.close();
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
async function queued(bytes = animatedGif()) {
  const value = await fresh({ claimedSizeBytes: bytes.length });
  expect((await post(value.form, bytes)).status).toBe(204);
  expect((await complete(value.uploadId)).statusCode).toBe(202);
  return value as {
    assetId: string;
    uploadId: string;
    form: { url: string; fields: Record<string, string> };
  };
}
async function claim() {
  const lease = await processing.claim();
  expect(lease).not.toBeNull();
  return lease!;
}
async function run(lease: MediaLease, storage = outputStorage) {
  return processJob(
    lease,
    processing,
    storage,
    workerConfig,
    new AbortController().signal,
  );
}
async function records(id: string) {
  const job = (
    await pool.query('SELECT * FROM media_jobs WHERE asset_id=$1', [id])
  ).rows[0];
  const variants = (
    await pool.query(
      'SELECT * FROM asset_variants WHERE asset_id=$1 ORDER BY name',
      [id],
    )
  ).rows;
  const receipt = (await detail(id)).json();
  return { job, variants, receipt };
}
async function expire(lease: MediaLease) {
  await pool.query(
    "UPDATE media_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [lease.id],
  );
}
function child(mode = 'run') {
  const process = spawn(
    globalThis.process.execPath,
    ['scripts/worker-test-process.mjs', mode],
    {
      env: {
        ...globalThis.process.env,
        ...Object.fromEntries(
          Object.entries(workerConfig).map(([k, v]) => [k, String(v)]),
        ),
        ALLOW_STORAGE_INTEGRATION_TESTS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '';
  process.stdout.on('data', (v) => {
    stdout += v.toString();
  });
  process.stderr.on('data', (v) => {
    stderr += v.toString();
  });
  const done = new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve) =>
    process.once('exit', (code) => resolve({ stdout, stderr, code })),
  );
  return {
    process,
    done,
    async uploaded() {
      const deadline = Date.now() + 10000;
      while (!stdout.includes('UPLOADED') && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 20));
      expect(stdout.includes('UPLOADED')).toBe(true);
    },
  };
}
describe('B04 real PostgreSQL, MinIO, FFmpeg and process recovery', () => {
  it('processes B03 pinned original despite overwrite, verifies real hashes/metadata/HEAD and all eight axes', async () => {
    const value = await queued();
    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_QUARANTINE_BUCKET,
        Key: value.form.fields.key,
        ContentType: 'image/gif',
        Body: Buffer.from('overwritten invalid latest'),
      }),
    );
    const lease = await claim();
    expect(await run(lease)).toBe('succeeded');
    const result = await records(value.assetId);
    expect(result.job.status).toBe('DONE');
    expect(result.job.lease_token).toBeNull();
    expect(result.receipt.states).toEqual({
      upload: 'RECEIVED',
      processing: 'SUCCEEDED',
      visibility: 'PRIVATE',
      searchEligibility: 'INELIGIBLE',
      indexing: 'NOT_INDEXED',
      apiAvailability: 'BLOCKED',
      deliveryReadiness: 'READY',
      moderation: 'PENDING',
    });
    expect(result.receipt.variantsReady).toBe(true);
    expect(
      result.variants.map((v) => [
        v.name,
        v.frame_count,
        v.width,
        v.height,
        v.duration_ms,
      ]),
    ).toEqual([
      ['DISPLAY_GIF', 2, 1, 1, 200],
      ['POSTER_PNG', 1, 1, 1, null],
    ]);
    for (const v of result.variants) {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: config.S3_DERIVATIVES_BUCKET,
          Key: v.object_key,
          VersionId: v.object_version_id,
        }),
      );
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(v.sha256);
      expect(bytes.length).toBe(Number(v.size_bytes));
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: config.S3_DERIVATIVES_BUCKET,
          Key: v.object_key,
          VersionId: v.object_version_id,
          ChecksumMode: 'ENABLED',
        }),
      );
      expect(head.ChecksumSHA256).toBe(
        Buffer.from(v.sha256, 'hex').toString('base64'),
      );
      expect(head.ContentType).toBe(v.mime_type);
      expect(
        (
          await fetch(
            `${config.S3_PUBLIC_ENDPOINT}/${config.S3_DERIVATIVES_BUCKET}/${v.object_key}`,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(
            `${config.S3_PUBLIC_ENDPOINT}/${config.S3_DERIVATIVES_BUCKET}/${v.object_key}?versionId=${encodeURIComponent(v.object_version_id)}`,
          )
        ).status,
      ).toBe(403);
      expect(JSON.stringify(result.receipt).includes(v.object_key)).toBe(false);
    }
    expect((await complete(value.uploadId)).json().processing).toBe(
      'SUCCEEDED',
    );
    expect((await detail(value.assetId, other)).statusCode).toBe(404);
    expect(
      (await app.inject(`/api/v1/me/assets/${value.assetId}`)).statusCode,
    ).toBe(401);
    for (const path of [
      `/media/${value.assetId}/display.gif`,
      `/media/${value.assetId}/poster.png`,
      '/api/v1/public/gifs',
    ])
      expect((await app.inject(path)).statusCode).toBe(404);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM search_documents'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM moderation_decisions'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE asset_id=$1 AND event_type='PROCESSING_SUCCEEDED'",
          [value.assetId],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(processing.succeed(lease, [], '')).rejects.toThrow();
    console.log(
      'PASS B04: pinned input, animated GIF 2 frames/200ms, PNG 1 frame, actual SHA256/HEAD, eight private axes and denials',
    );
  });
  it('two independent worker processes cannot claim one job or complete it with stale tokens', async () => {
    const value = await queued();
    const results = await Promise.all([
      child('claim').done,
      child('claim').done,
    ]);
    expect(results.filter((v) => v.stdout.includes('CLAIMED')).length).toBe(1);
    expect(results.filter((v) => v.stdout.includes('NO_JOB')).length).toBe(1);
    expect(results.every((v) => v.stderr === '' && v.code === 0)).toBe(true);
    const state = await records(value.assetId);
    expect(state.job.attempt_count).toBe(1);
    await pool.query(
      "UPDATE media_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE asset_id=$1",
      [value.assetId],
    );
    expect(await run(await claim())).toBe('succeeded');
    console.log(
      'PASS B04: two actual worker processes, exactly one atomic SKIP LOCKED claim',
    );
  });
  it('heartbeats preserve ownership, expired leases cannot heartbeat/fail/commit, replacement completes once', async () => {
    const value = await queued();
    const old = await claim();
    const before = (await records(value.assetId)).job.lease_until;
    await new Promise((r) => setTimeout(r, 30));
    expect(await processing.heartbeat(old)).toBe(true);
    expect(
      (await records(value.assetId)).job.lease_until.getTime(),
    ).toBeGreaterThan(before.getTime());
    expect(await processing.claim()).toBeNull();
    await expire(old);
    expect(await processing.heartbeat(old)).toBe(false);
    await expect(
      processing.fail(old, 'MEDIA_INVALID', false),
    ).rejects.toBeInstanceOf(StaleLease);
    const replacement = await claim();
    expect(replacement.token).not.toBe(old.token);
    expect(await run(replacement)).toBe('succeeded');
    const variants = (await records(value.assetId)).variants.map((v) => ({
      name: v.name,
      objectKey: v.object_key,
      objectVersionId: v.object_version_id,
      mimeType: v.mime_type,
      sizeBytes: Number(v.size_bytes),
      width: v.width,
      height: v.height,
      durationMs: v.duration_ms,
      frameCount: v.frame_count,
      sha256: v.sha256,
    }));
    await expect(
      processing.succeed(old, variants, '0'.repeat(64)),
    ).rejects.toBeInstanceOf(StaleLease);
    await expect(
      processing.succeed(replacement, variants, '0'.repeat(64)),
    ).rejects.toBeInstanceOf(StaleLease);
    expect((await records(value.assetId)).variants).toHaveLength(2);
  });
  it('SIGKILL after derivative upload, before DB commit, then restart recovers without duplicate variants or object versions', async () => {
    const value = await queued();
    const first = child('crash-after-upload');
    try {
      await first.uploaded();
    } finally {
      first.process.kill('SIGKILL');
      await first.done;
    }
    const before = await records(value.assetId);
    expect(before.variants).toHaveLength(0);
    expect(before.job.status).toBe('RUNNING');
    // Wait for actual persisted expiry (no clock mutation) then restart a new OS process.
    await new Promise((r) => setTimeout(r, 3200));
    const recovered = await child().done;
    expect(recovered.stdout).toContain('succeeded');
    expect(recovered.stderr).toBe('');
    expect(recovered.code).toBe(0);
    const after = await records(value.assetId);
    expect(after.variants).toHaveLength(2);
    expect(after.job.attempt_count).toBe(2);
    const objects = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: config.S3_DERIVATIVES_BUCKET,
        Prefix: `assets/${value.assetId}/`,
      }),
    );
    expect(objects.Versions).toHaveLength(2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE asset_id=$1 AND event_type='PROCESSING_SUCCEEDED'",
          [value.assetId],
        )
      ).rows[0].n,
    ).toBe(1);
    console.log(
      'PASS B04: actual SIGKILL after two uploads; zero variants before commit; expired lease restart; exactly two object versions/two variants/one success audit',
    );
  }, 20000);
  it('rolls back variants, states, audit and job together on commit failure, then reconciles uploaded objects', async () => {
    const value = await queued();
    const lease = await claim();
    await pool.query(
      "CREATE FUNCTION b04_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='PROCESSING_SUCCEEDED' THEN RAISE EXCEPTION 'private injected failure'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER b04_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION b04_fail_audit()',
    );
    try {
      expect(await run(lease)).toBe('DATABASE_TEMPORARY');
    } finally {
      await pool.query('DROP TRIGGER b04_fail_audit ON audit_events');
      await pool.query('DROP FUNCTION b04_fail_audit()');
    }
    const failed = await records(value.assetId);
    expect(failed.variants).toHaveLength(0);
    expect(failed.receipt.states.processing).toBe('FAILED_RETRYABLE');
    expect(failed.job.available_at.getTime()).toBeGreaterThan(Date.now());
    await pool.query(
      'UPDATE media_jobs SET available_at=clock_timestamp() WHERE id=$1',
      [lease.id],
    );
    expect(await run(await claim())).toBe('succeeded');
    expect((await records(value.assetId)).variants).toHaveLength(2);
  });
  it('retries transient storage/processing failures with persisted bounded backoff and reaches terminal at maximum attempts', async () => {
    const value = await queued();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const lease = await claim();
      expect(lease.attempt).toBe(attempt);
      expect(
        await run(lease, {
          ...outputStorage,
          download: async () => {
            throw new Error('secret credential /raw/private/path');
          },
        }),
      ).toBe('STORAGE_TEMPORARY');
      const result = await records(value.assetId);
      expect(result.job.status).toBe(attempt < 3 ? 'READY' : 'DEAD');
      expect(result.receipt.states.processing).toBe(
        attempt < 3 ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL',
      );
      expect(JSON.stringify(result.receipt)).not.toContain('secret credential');
      const delay = result.job.available_at.getTime() - Date.now();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(301000);
      await pool.query(
        'UPDATE media_jobs SET available_at=clock_timestamp() WHERE id=$1',
        [lease.id],
      );
    }
    expect(await processing.claim()).toBeNull();
    const transient = await queued();
    const lease = await claim();
    await processing.fail(lease, 'FFMPEG_RESOURCE_TRANSIENT', true);
    expect((await records(transient.assetId)).receipt.states.processing).toBe(
      'FAILED_RETRYABLE',
    );
    await pool.query(
      'UPDATE media_jobs SET available_at=clock_timestamp() WHERE id=$1',
      [lease.id],
    );
    expect(await run(await claim())).toBe('succeeded');
  });
  it('exhausts repeatedly crashed final leases rather than leaving RUNNING forever', async () => {
    const value = await queued();
    for (let i = 0; i < 3; i++) {
      const lease = await claim();
      await expire(lease);
    }
    expect(await processing.claim()).toBeNull();
    const result = await records(value.assetId);
    expect(result.job.status).toBe('DEAD');
    expect(result.receipt.errorCode).toBe('ATTEMPTS_EXHAUSTED');
    expect(result.receipt.states.processing).toBe('FAILED_TERMINAL');
  });
  it('rejects still/wrong/malformed bytes terminally without variants and exposes typed safe errors', async () => {
    const gif = animatedGif();
    const still = Buffer.concat([
      gif.subarray(0, gif.length - 24),
      Buffer.from([0x3b]),
    ]);
    for (const [bytes, code] of [
      [still, 'MEDIA_NOT_ANIMATED'],
      [Buffer.from('fake gif bytes'), 'MEDIA_INVALID'],
      [Buffer.from('GIF89a malformed;'), 'MEDIA_DIMENSIONS_EXCEEDED'],
    ] as const) {
      const value = await queued(bytes);
      const result = await run(await claim());
      expect(result).toBe(code);
      const stored = await records(value.assetId);
      expect(stored.job.status).toBe('DEAD');
      expect(stored.variants).toHaveLength(0);
      expect(stored.receipt.errorCode).toBe(code);
      expect(stored.receipt.states).toMatchObject({
        processing: 'FAILED_TERMINAL',
        moderation: 'NOT_REQUESTED',
        deliveryReadiness: 'NOT_READY',
        visibility: 'PRIVATE',
      });
    }
  });
});

it('restricted worker database identity cannot approve, publish, index, alter upload receipts, change roles, or read sessions', async () => {
  const restricted = new pg.Pool({ connectionString: workerTarget.href });
  try {
    for (const sql of [
      "UPDATE asset_states SET moderation_state='APPROVED'",
      "UPDATE asset_states SET visibility_state='PUBLIC'",
      "INSERT INTO search_documents(asset_id,title,tag_text) SELECT id,'unsafe','unsafe' FROM assets",
      "UPDATE upload_sessions SET received_version_id='replacement'",
      'SELECT * FROM sessions',
      "INSERT INTO role_grants(user_id,role) SELECT id,'ADMIN' FROM users",
    ])
      await expect(restricted.query(sql)).rejects.toMatchObject({
        code: '42501',
      });
  } finally {
    await restricted.end();
  }
});

it('worker S3 identity cannot change bucket policy, replace quarantine, delete pinned outputs or write outside derivative prefix', async () => {
  const limited = s3Client(workerStorageConfig);
  try {
    const object = (
      await pool.query('SELECT object_key FROM asset_variants LIMIT 1')
    ).rows[0].object_key;
    const publicPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${config.S3_DERIVATIVES_BUCKET}/*`,
        },
      ],
    });
    const requests = [
      () =>
        limited.send(
          new PutBucketPolicyCommand({
            Bucket: config.S3_DERIVATIVES_BUCKET,
            Policy: publicPolicy,
          }),
        ),
      () =>
        limited.send(
          new PutObjectCommand({
            Bucket: config.S3_QUARANTINE_BUCKET,
            Key: 'quarantine/unsafe.gif',
            Body: animatedGif(),
          }),
        ),
      () =>
        limited.send(
          new PutObjectCommand({
            Bucket: config.S3_DERIVATIVES_BUCKET,
            Key: 'outside-prefix.gif',
            Body: animatedGif(),
          }),
        ),
      () =>
        limited.send(
          new DeleteObjectCommand({
            Bucket: config.S3_DERIVATIVES_BUCKET,
            Key: object,
          }),
        ),
    ];
    for (const request of requests)
      await expect(request()).rejects.toMatchObject({
        $metadata: { httpStatusCode: 403 },
      });
  } finally {
    limited.destroy();
  }
});
