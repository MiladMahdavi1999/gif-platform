import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import { LoginLimiter } from '../../../apps/api/src/auth.js';
import {
  createAuthRepository,
  createUploadRepository,
  createProcessingRepository,
  createReviewRepository,
  createPublicRepository,
} from '@gif/db';
import {
  createProcessingStorage,
  createReviewStorage,
  createPublicStorage,
  createUploadStorage,
  provisionPrivateStorage,
  s3Client,
  type StorageConfig,
} from '@gif/storage';
import { readWorkerConfig } from '@gif/config';
import { processJob } from '../../../apps/worker/src/process-job.js';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase, seedDevelopment } from './dev.js';
import { animatedGif } from '@gif/testing';
import { publicDetailSchema } from '@gif/contracts';
import { createPickerSession } from '../../../apps/web/app/picker/picker-session.js';
import { PickerReadError } from '../../../apps/web/app/picker/public-read.js';
import {
  PutObjectCommand,
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
const name = `gif_platform_b06_${suffix}_test`;
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
  S3_QUARANTINE_BUCKET: `gif-b06-${suffix}`,
  S3_DERIVATIVES_BUCKET: `gif-b06-out-${suffix}`,
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
  throw new Error('Explicit local MinIO configuration required');
const admin = new pg.Pool({ connectionString: source.href });
const pool = new pg.Pool({ connectionString: target.href });
const auth = createAuthRepository(target.href);
const uploads = createUploadRepository(target.href);
const processing = createProcessingRepository(target.href, 3, 30);
const review = createReviewRepository(target.href);
const uploadStorage = createUploadStorage(config);
const processingStorage = createProcessingStorage(config);
const reviewStorage = createReviewStorage(config);
const publicRead = createPublicRepository(
  target.href,
  'test_b06_cursor_signing_key_at_least_32_bytes',
);
const publicStorage = createPublicStorage(config);
const s3 = s3Client(config);
const workerConfig = readWorkerConfig({
  ...config,
  MAX_GIF_UPLOAD_BYTES: '1024',
  DATABASE_URL: target.href,
  PUBLIC_BASE_URL: 'http://localhost:8080',
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
    storage: uploadStorage.storage,
    ttlSeconds: 600,
    maxBytes: 1024,
  },
  { repository: review.repository, storage: reviewStorage },
  {
    repository: publicRead.repository,
    storage: publicStorage,
    cacheSeconds: 30,
  },
);
type Account = { cookie: string; csrf: string; id: string };
let uploader: Account, reviewer: Account;
const fixtureUploaders: Account[] = [];
let fixtureNumber = 0;
let created = false,
  storageCreated = false;
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
  const user = (
    await pool.query(
      "INSERT INTO users(email,password_hash) SELECT 'second@local.test',password_hash FROM users WHERE email='reviewer@local.test' RETURNING id",
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO role_grants(user_id,role) VALUES($1,'REVIEWER')",
    [user.id],
  );
  await provisionPrivateStorage(config);
  storageCreated = true;
  await app.ready();
  uploader = await login('uploader@local.test');
  reviewer = await login('reviewer@local.test');

  const auxiliary = (
    await pool.query(
      "INSERT INTO users(email,password_hash) SELECT 'auxiliary@local.test',password_hash FROM users WHERE email='uploader@local.test' RETURNING id",
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO role_grants(user_id,role) VALUES($1,'UPLOADER')",
    [auxiliary.id],
  );
  fixtureUploaders.push(uploader, await login('auxiliary@local.test'));
});
afterAll(async () => {
  await app.close();
  await auth.close();
  await uploads.close();
  await processing.close();
  await review.close();
  await publicRead.close();
  publicStorage.close();
  uploadStorage.close();
  processingStorage.close();
  reviewStorage.close();
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
  if (storageCreated)
    for (const Bucket of [
      config.S3_QUARANTINE_BUCKET,
      config.S3_DERIVATIVES_BUCKET,
    ]) {
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
async function login(email: string): Promise<Account> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  expect(r.statusCode).toBe(200);
  return {
    cookie: `gif_session=${r.cookies[0]!.value}`,
    csrf: r.json().csrfToken,
    id: r.json().user.id,
  };
}
const headers = (a = reviewer) => ({
  origin,
  cookie: a.cookie,
  'x-csrf-token': a.csrf,
});
const decision = (
  id: string,
  action = 'APPROVE',
  extra: Record<string, unknown> = {},
  a = reviewer,
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/review/assets/${id}/${action === 'REMOVE' ? 'remove' : 'decision'}`,
    headers: headers(a),
    payload: {
      ...(action === 'REMOVE' ? {} : { decision: action }),
      reasonCode: action === 'APPROVE' ? 'POLICY_PASSED' : 'POLICY_VIOLATION',
      expectedVersion: action === 'REMOVE' ? 2 : 1,
      ...extra,
    },
  });
async function fixture(
  process = true,
  owner = fixtureUploaders[fixtureNumber++ % fixtureUploaders.length]!,
  title = `B06 original ${randomUUID()}`,
) {
  const intent = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads',
    headers: { ...headers(owner), 'idempotency-key': randomUUID() },
    payload: {
      kind: 'GIF',
      title,
      tags: ['owned', 'آزمایش'],
      rightsAttested: true,
      rightsAttestationVersion: 'v1',
      claimedSizeBytes: animatedGif().length,
    },
  });
  expect(intent.statusCode).toBe(201);
  const value = intent.json();
  const data = new FormData();
  for (const [key, v] of Object.entries(value.form.fields))
    data.append(key, v as string);
  data.append(
    'file',
    new Blob([new Uint8Array(animatedGif())], { type: 'image/gif' }),
    'owned.gif',
  );
  expect(
    (await fetch(value.form.url, { method: 'POST', body: data })).status,
  ).toBe(204);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/uploads/${value.uploadId}/complete`,
        headers: headers(owner),
        payload: {},
      })
    ).statusCode,
  ).toBe(202);
  if (process) {
    const lease = await processing.claim();
    expect(lease?.assetId).toBe(value.assetId);
    expect(
      await processJob(
        lease!,
        processing,
        processingStorage,
        workerConfig,
        new AbortController().signal,
      ),
    ).toBe('succeeded');
  }
  return value.assetId as string;
}
async function snapshot(id: string) {
  return (
    await pool.query(
      `SELECT a.row_version,s.*, (SELECT count(*)::int FROM moderation_decisions WHERE asset_id=a.id) AS decisions,(SELECT count(*)::int FROM audit_events WHERE asset_id=a.id AND event_type LIKE 'MODERATION_%') AS audits,(SELECT count(*)::int FROM search_documents WHERE asset_id=a.id) AS documents FROM assets a JOIN asset_states s ON s.asset_id=a.id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
}
const list = (query = '') =>
  app.inject({ url: `/api/v1/public/gifs${query ? `?${query}` : ''}` });
const publicDetail = (id: string) =>
  app.inject({ url: `/api/v1/public/gifs/${id}` });
const media = (id: string, variant = 'display.gif', extra = {}) =>
  app.inject({ url: `/media/${id}/${variant}`, ...extra });
const approve = async (id: string) =>
  expect((await decision(id)).statusCode).toBe(200);
async function hidden(id: string) {
  expect((await publicDetail(id)).statusCode).toBe(404);
  for (const alias of ['display.gif', 'poster.png'])
    expect((await media(id, alias)).statusCode).toBe(404);
  expect(
    (await list()).json().items.some((v: { id: string }) => v.id === id),
  ).toBe(false);
}
describe('B06 real PostgreSQL/MinIO/FFmpeg public discovery and origin', () => {
  it('B07 selection rechecks authoritative detail after listing and denies newly ineligible and removed GIFs', async () => {
    const id = await fixture();
    await approve(id);
    expect(
      (await list())
        .json()
        .items.some((item: { id: string }) => item.id === id),
    ).toBe(true);
    const results: string[] = [];
    const lookup = async (assetId: string) => {
      const response = await publicDetail(assetId);
      if (response.statusCode !== 200)
        throw new PickerReadError(response.statusCode === 404);
      return publicDetailSchema.parse(response.json());
    };
    const session = createPickerSession(
      {
        onSelect: () => results.push('selected'),
        onCancel: () => results.push('cancelled'),
        onError: (error) => results.push(error.code),
      },
      lookup,
    );
    await pool.query(
      "UPDATE assets SET rights_attestation_version='revoked' WHERE id=$1",
      [id],
    );
    await session.select(id);
    expect(results).toEqual(['GIF_RESTRICTED']);
    await pool.query(
      "UPDATE assets SET rights_attestation_version='v1' WHERE id=$1",
      [id],
    );
    expect((await decision(id, 'REMOVE')).statusCode).toBe(200);
    await session.select(id);
    expect(results).toEqual(['GIF_RESTRICTED', 'GIF_RESTRICTED']);
    session.cancel();
    expect(results.at(-1)).toBe('cancelled');
    expect((await snapshot(id)).decisions).toBe(2);
  });
  it('B07 concurrent selection events return one fresh selected reference and perform no Host write', async () => {
    const id = await fixture();
    await approve(id);
    const before = await snapshot(id);
    const references: unknown[] = [];
    const session = createPickerSession(
      {
        onSelect: (reference) => references.push(reference),
        onCancel: () => {
          throw new Error('Unexpected cancellation');
        },
        onError: () => {
          throw new Error('Unexpected selection error');
        },
      },
      async (assetId) =>
        publicDetailSchema.parse((await publicDetail(assetId)).json()),
    );
    await Promise.all([
      session.select(id),
      session.select(id),
      session.select(id),
    ]);
    session.cancel();
    expect(references).toEqual([
      {
        id,
        kind: 'GIF',
        title: expect.any(String),
        posterUrl: `/media/${id}/poster.png`,
        displayUrl: `/media/${id}/display.gif`,
      },
    ]);
    expect(await snapshot(id)).toEqual(before);
  });
  it('processed approved GIF is discoverable by title and normalized Unicode tags, with anonymous detail and verified media', async () => {
    const id = await fixture(true, undefined, 'Celestial Lantern');
    await hidden(id);
    await approve(id);
    for (const query of [
      'q=CELESTIAL',
      'q=owned',
      `q=${encodeURIComponent('آزمایش')}`,
      'tag=OWNED',
      `tag=${encodeURIComponent('آزمایش')}`,
      'q=lantern&tag=owned',
    ]) {
      const response = await list(query);
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((x: { id: string }) => x.id)).toContain(
        id,
      );
      expect(response.body).not.toMatch(
        /@local|objectKey|objectVersion|quarantine|gif-b06|password|email|https?:\/\//,
      );
    }
    expect((await media(id.toUpperCase())).statusCode).toBe(200);
    expect((await snapshot(id)).delivery_readiness_state).toBe('READY');
    const response = await publicDetail(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id,
      title: 'Celestial Lantern',
      description: null,
      displayUrl: `/media/${id}/display.gif`,
      posterUrl: `/media/${id}/poster.png`,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    for (const [alias, mime] of [
      ['display.gif', 'image/gif'],
      ['poster.png', 'image/png'],
    ]) {
      const response = await media(id, alias);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(mime);
      expect(Number(response.headers['content-length'])).toBe(
        response.rawPayload.length,
      );
      expect(response.headers.etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=30, must-revalidate',
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cross-origin-resource-policy']).toBe(
        'same-origin',
      );
      expect(response.headers['content-security-policy']).toContain('sandbox');
      expect(response.headers.location).toBeUndefined();
    }
  });
  it('rank and recent keyset pages preserve microseconds and id tie breakers without duplicates or omissions', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const id = await fixture(
        true,
        undefined,
        i === 0 ? 'Nebula Nebula Nebula' : 'Nebula',
      );
      await approve(id);
      ids.push(id);
    }
    for (let i = 0; i < ids.length; i++)
      await pool.query('UPDATE assets SET created_at=$2 WHERE id=$1', [
        ids[i],
        `2026-01-01T00:00:00.12300${i < 2 ? i : 2}Z`,
      ]);
    for (const q of ['nebula', '']) {
      const all = (await list(`q=${q}&tag=owned&limit=50`))
        .json()
        .items.map((x: { id: string }) => x.id);
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list(
          `q=${q}&tag=owned&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(page.statusCode).toBe(200);
        const value = page.json();
        found.push(...value.items.map((x: { id: string }) => x.id));
        cursor = value.nextCursor;
      } while (cursor);
      expect(found).toEqual(all);
      expect(new Set(found).size).toBe(found.length);
      expect(ids.every((id) => found.includes(id))).toBe(true);
      if (q) expect(found[0]).toBe(ids[0]);
      const first = (await list(`q=${q}&tag=owned&limit=1`)).json();
      expect(
        (
          await list(`q=${q}&tag=owned&limit=1&cursor=${first.nextCursor}`)
        ).json(),
      ).toEqual(
        (
          await list(`q=${q}&tag=owned&limit=1&cursor=${first.nextCursor}`)
        ).json(),
      );
    }
  });
  it('rejects malformed, tampered and query/tag mismatched cursors and bounds inputs', async () => {
    const first = (await list('limit=1')).json();
    expect(first.nextCursor).toBeTruthy();
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=wat',
      'unknown=1',
      'cursor=garbage',
      `q=${'x'.repeat(101)}`,
      `tag=${'x'.repeat(65)}`,
      `cursor=${first.nextCursor}x`,
      `q=changed&cursor=${first.nextCursor}`,
      `tag=changed&cursor=${first.nextCursor}`,
    ])
      expect((await list(query)).statusCode).toBe(400);
    expect((await list('q=%20%20')).statusCode).toBe(200);
    expect((await list('q=zzzznomatchingcontent')).json()).toEqual({
      items: [],
    });
    expect((await list('q=%27%3BSELECT%201%3B--')).statusCode).toBe(200);
  });
  it('checks each authoritative axis, GIF kind and rights even with a stale eligible search projection', async () => {
    const id = await fixture();
    await approve(id);
    for (const [column, blocked, allowed] of [
      ['upload_state', 'INTENT', 'RECEIVED'],
      ['processing_state', 'RUNNING', 'SUCCEEDED'],
      ['moderation_state', 'PENDING', 'APPROVED'],
      ['moderation_state', 'REJECTED', 'APPROVED'],
      ['moderation_state', 'REMOVED', 'APPROVED'],
      ['visibility_state', 'PRIVATE', 'PUBLIC'],
      ['visibility_state', 'RESTRICTED', 'PUBLIC'],
      ['search_eligibility_state', 'INELIGIBLE', 'ELIGIBLE'],
      ['indexing_state', 'STALE', 'INDEXED'],
      ['indexing_state', 'NOT_INDEXED', 'INDEXED'],
      ['api_availability_state', 'BLOCKED', 'ENABLED'],
      ['delivery_readiness_state', 'DEGRADED', 'READY'],
      ['delivery_readiness_state', 'NOT_READY', 'READY'],
    ]) {
      await pool.query(
        `UPDATE asset_states SET ${column}=$2 WHERE asset_id=$1`,
        [id, blocked],
      );
      expect(
        (
          await pool.query('SELECT 1 FROM search_documents WHERE asset_id=$1', [
            id,
          ])
        ).rowCount,
      ).toBe(1);
      await hidden(id);
      await pool.query(
        `UPDATE asset_states SET ${column}=$2 WHERE asset_id=$1`,
        [id, allowed],
      );
    }
    await pool.query("UPDATE assets SET kind='STICKER' WHERE id=$1", [id]);
    await hidden(id);
    await pool.query(
      "UPDATE assets SET kind='GIF',rights_attestation_version='unknown' WHERE id=$1",
      [id],
    );
    await hidden(id);
  });
  it('pending, rejected and guessed IDs stay inaccessible; removal immediately revokes prior direct and conditional URLs', async () => {
    const pending = await fixture();
    await hidden(pending);
    const rejected = await fixture();
    expect((await decision(rejected, 'REJECT')).statusCode).toBe(200);
    await hidden(rejected);
    await hidden(randomUUID());
    const id = await fixture();
    await approve(id);
    const before = await media(id);
    expect(before.statusCode).toBe(200);
    expect((await decision(id, 'REMOVE')).statusCode).toBe(200);
    // Deliberately restore stale projection after actual moderation removal.
    await pool.query(
      "INSERT INTO search_documents(asset_id,title,tag_text) VALUES($1,'stale removal','owned')",
      [id],
    );
    await hidden(id);
    for (const headers of [
      { 'if-none-match': String(before.headers.etag) },
      { range: 'bytes=0-10' },
    ])
      expect((await media(id, 'display.gif', { headers })).statusCode).toBe(
        404,
      );
    expect((await snapshot(id)).decisions).toBe(2);
  });
  it('rejects originals, arbitrary variants, object-key paths and malformed IDs without leaking storage identifiers', async () => {
    const id = await fixture();
    await approve(id);
    for (const alias of [
      'ORIGINAL',
      'DISPLAY_GIF',
      'source.gif',
      'poster.svg',
      '%2e%2e',
      'quarantine%2Foriginal.gif',
    ]) {
      const response = await media(id, alias);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toMatch(
        /gif-b06|objectKey|objectVersion|quarantine\/|X-Amz|S3_/,
      );
    }
    expect((await publicDetail('invalid')).statusCode).toBe(404);
    expect((await media('invalid')).statusCode).toBe(404);
  });
  it('missing pinned derivative returns typed 503 and only degrades technical state with one durable audit', async () => {
    const id = await fixture();
    await approve(id);
    const v = await review.repository.preview(id, 'DISPLAY_GIF');
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.S3_DERIVATIVES_BUCKET,
        Key: v.objectKey,
        VersionId: v.objectVersionId,
      }),
    );
    const failed = await media(id);
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toMatchObject({
      code: 'MEDIA_UNAVAILABLE',
      requestId: expect.any(String),
    });
    expect(failed.headers['cache-control']).toBe('no-store');
    const state = await snapshot(id);
    expect(state).toMatchObject({
      processing_state: 'SUCCEEDED',
      moderation_state: 'APPROVED',
      visibility_state: 'PUBLIC',
      search_eligibility_state: 'ELIGIBLE',
      indexing_state: 'INDEXED',
      api_availability_state: 'ENABLED',
      delivery_readiness_state: 'DEGRADED',
      documents: 1,
      decisions: 1,
      row_version: '3',
    });
    await hidden(id);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE asset_id=$1 AND event_type='DELIVERY_DEGRADED'",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('corrupt pinned derivative produces no bytes and records technical degradation', async () => {
    const id = await fixture();
    await approve(id);
    const v = await review.repository.preview(id, 'DISPLAY_GIF');
    const corrupt = Buffer.alloc(v.sizeBytes, 65);
    const replaced = await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_DERIVATIVES_BUCKET,
        Key: v.objectKey,
        Body: corrupt,
        ContentType: v.mimeType,
        Metadata: { sha256: v.sha256 },
      }),
    );
    await pool.query(
      "UPDATE asset_variants SET object_version_id=$2 WHERE asset_id=$1 AND name='DISPLAY_GIF'",
      [id, replaced.VersionId],
    );
    const response = await media(id);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('MEDIA_UNAVAILABLE');
    expect((await snapshot(id)).delivery_readiness_state).toBe('DEGRADED');
  });
  it('missing variant metadata degrades without changing approval or exposing another version', async () => {
    const id = await fixture();
    await approve(id);
    await pool.query(
      "DELETE FROM asset_variants WHERE asset_id=$1 AND name='POSTER_PNG'",
      [id],
    );
    expect((await media(id, 'poster.png')).statusCode).toBe(503);
    expect((await snapshot(id)).delivery_readiness_state).toBe('DEGRADED');
    await hidden(id);
  });
  it('temporary storage transport failures are typed and do not falsely record lost derivatives', async () => {
    const id = await fixture();
    await approve(id);
    const unavailable = createPublicStorage({
      ...config,
      S3_INTERNAL_ENDPOINT: 'http://127.0.0.1:1',
    });
    const failing = createApp(
      { database: async () => {}, storage: async () => {} },
      false,
      undefined,
      undefined,
      undefined,
      {
        repository: publicRead.repository,
        storage: unavailable,
        cacheSeconds: 0,
      },
    );
    try {
      const response = await failing.inject({
        url: `/media/${id}/display.gif`,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('MEDIA_UNAVAILABLE');
      expect((await snapshot(id)).delivery_readiness_state).toBe('READY');
    } finally {
      await failing.close();
      unavailable.close();
    }
  });
  it('removal committed during a storage read wins the final response gate and stale degradation cannot overwrite it', async () => {
    const id = await fixture();
    await approve(id);
    const observed = (
      await publicRead.repository.media(id, 'display.gif', 'observe')
    ).values;
    const raced = createApp(
      { database: async () => {}, storage: async () => {} },
      false,
      undefined,
      undefined,
      undefined,
      {
        repository: publicRead.repository,
        storage: {
          ...publicStorage,
          read: async (value) => {
            const bytes = await publicStorage.read(value);
            expect((await decision(id, 'REMOVE')).statusCode).toBe(200);
            return bytes;
          },
        },
        cacheSeconds: 0,
      },
    );
    try {
      expect(
        (await raced.inject({ url: `/media/${id}/display.gif` })).statusCode,
      ).toBe(404);
    } finally {
      await raced.close();
    }
    await publicRead.repository.degrade(id, observed, 'stale-observation');
    expect(await snapshot(id)).toMatchObject({
      moderation_state: 'REMOVED',
      delivery_readiness_state: 'READY',
    });
  });
});
