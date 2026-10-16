import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../../apps/api/src/app.js';
import { LoginLimiter } from '../../../apps/api/src/auth.js';
import {
  createAuthRepository,
  createUploadRepository,
  createPublicRepository,
  createProcessingRepository,
  createReviewRepository,
} from '@gif/db';
import {
  createProcessingStorage,
  createReviewStorage,
  createUploadStorage,
  createPublicStorage,
  provisionPrivateStorage,
  s3Client,
  type StorageConfig,
} from '@gif/storage';
import { readWorkerConfig } from '@gif/config';
import { processJob } from '../../../apps/worker/src/process-job.js';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase, seedDevelopment } from './dev.js';
import { animatedGif } from '@gif/testing';
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
const name = `gif_platform_b05_${suffix}_test`;
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
  S3_QUARANTINE_BUCKET: `gif-b05-${suffix}`,
  S3_DERIVATIVES_BUCKET: `gif-b05-out-${suffix}`,
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
const s3 = s3Client(config);
const workerConfig = readWorkerConfig({
  ...config,
  MAX_GIF_UPLOAD_BYTES: '1024',
  DATABASE_URL: target.href,
  PUBLIC_BASE_URL: 'http://localhost:8080',
} as unknown as NodeJS.ProcessEnv);
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
let uploader: Account, reviewer: Account, second: Account;
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
  second = await login('second@local.test');
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
  await publicRead.close();
  publicStorage.close();
  await auth.close();
  await uploads.close();
  await processing.close();
  await review.close();
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
const detail = (id: string, a = reviewer) =>
  app.inject({ url: `/api/v1/review/assets/${id}`, headers: headers(a) });
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
) {
  const intent = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads',
    headers: { ...headers(owner), 'idempotency-key': randomUUID() },
    payload: {
      kind: 'GIF',
      title: `B05 original ${randomUUID()}`,
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
describe('B05 real PostgreSQL/MinIO/processed GIF review', () => {
  it('queue contains only successfully processed pending assets, with bounded stable pagination', async () => {
    const ids = [await fixture(), await fixture()];
    const first = await app.inject({
      url: '/api/v1/review/queue?limit=1',
      headers: headers(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    const next = await app.inject({
      url: `/api/v1/review/queue?limit=1&cursor=${first.json().nextCursor}`,
      headers: headers(),
    });
    expect(
      new Set([first.json().items[0].assetId, next.json().items[0].assetId]),
    ).toEqual(new Set(ids));
    expect(
      (
        await app.inject({
          url: '/api/v1/review/queue?limit=51',
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/api/v1/review/queue?unknown=1',
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/api/v1/review/queue?cursor=${randomUUID()}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
    for (const id of ids)
      expect((await decision(id, 'REJECT')).statusCode).toBe(200);
    const unprocessed = await fixture(false);
    const queue = (
      await app.inject({ url: '/api/v1/review/queue', headers: headers() })
    ).json();
    expect(queue.items).toEqual([]);
    const lease = await processing.claim();
    expect(lease?.assetId).toBe(unprocessed);
    expect(
      await processJob(
        lease!,
        processing,
        processingStorage,
        workerConfig,
        new AbortController().signal,
      ),
    ).toBe('succeeded');
    await decision(unprocessed, 'REJECT');
  });
  it('reviewer sees safe private GIF/PNG; anonymous/uploader cannot read review operations or previews', async () => {
    const id = await fixture();
    const summary = await detail(id);
    expect(summary.statusCode).toBe(200);
    expect(summary.json().previews).toHaveLength(2);
    // Safe re-encoding can grow a tiny upload; preview budgets use the output limit.
    const descriptor = await review.repository.preview(id, 'DISPLAY_GIF');
    const independentLimit = createReviewStorage({
      ...config,
      MAX_GIF_UPLOAD_BYTES: 1,
      MAX_GIF_OUTPUT_BYTES: 20971520,
    });
    const tooSmall = createReviewStorage({
      ...config,
      MAX_GIF_OUTPUT_BYTES: 1,
    });
    try {
      expect((await independentLimit.read(descriptor)).length).toBe(
        descriptor.sizeBytes,
      );
      await expect(tooSmall.read(descriptor)).rejects.toMatchObject({
        status: 409,
        code: 'DERIVATIVES_UNVERIFIED',
      });
    } finally {
      independentLimit.close();
      tooSmall.close();
    }
    expect(summary.body).not.toMatch(
      /objectKey|objectVersion|quarantine\/|https?:\/\//,
    );
    for (const variant of ['DISPLAY_GIF', 'POSTER_PNG']) {
      const url = `/api/v1/review/assets/${id}/media/${variant}`;
      const preview = await app.inject({ url, headers: headers() });
      expect(preview.statusCode).toBe(200);
      expect(preview.headers['cache-control']).toBe('no-store');
      expect(preview.headers['x-content-type-options']).toBe('nosniff');
      expect(
        preview.rawPayload.subarray(0, variant === 'DISPLAY_GIF' ? 6 : 8),
      ).toEqual(
        variant === 'DISPLAY_GIF'
          ? Buffer.from('GIF89a')
          : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
    for (const a of [null, uploader])
      for (const [method, url, payload] of [
        ['GET', '/api/v1/review/queue', undefined],
        ['GET', `/api/v1/review/assets/${id}`, undefined],
        ['GET', `/api/v1/review/assets/${id}/media/DISPLAY_GIF`, undefined],
        ['GET', `/api/v1/review/assets/${id}/media/POSTER_PNG`, undefined],
        [
          'POST',
          `/api/v1/review/assets/${id}/decision`,
          {
            decision: 'APPROVE',
            reasonCode: 'POLICY_PASSED',
            expectedVersion: 1,
          },
        ],
        [
          'POST',
          `/api/v1/review/assets/${id}/remove`,
          { reasonCode: 'RIGHTS_REQUEST', expectedVersion: 1 },
        ],
      ] as const) {
        const r = await app.inject({
          method,
          url,
          headers: a ? headers(a) : { origin },
          ...(payload ? { payload } : {}),
        });
        expect(r.statusCode).toBe(a ? 403 : 401);
      }
    for (const variant of [
      'ORIGINAL',
      'original.gif',
      'quarantine',
      'display.gif',
      '%2e%2e',
    ])
      expect(
        (
          await app.inject({
            url: `/api/v1/review/assets/${id}/media/${variant}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(404);
    expect((await snapshot(id)).decisions).toBe(0);
  });
  it('approval atomically grants each policy axis, projects title/tags and retains attributed decision/audit', async () => {
    const id = await fixture();
    const r = await decision(id, 'APPROVE', {
      reasonNote: 'Owned animation checked',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().rowVersion).toBe(2);
    expect(r.json().states).toEqual({
      upload: 'RECEIVED',
      processing: 'SUCCEEDED',
      deliveryReadiness: 'READY',
      moderation: 'APPROVED',
      visibility: 'PUBLIC',
      searchEligibility: 'ELIGIBLE',
      indexing: 'INDEXED',
      apiAvailability: 'ENABLED',
    });
    expect(await snapshot(id)).toMatchObject({
      row_version: '2',
      decisions: 1,
      audits: 1,
      documents: 1,
    });
    const document = (
      await pool.query('SELECT * FROM search_documents WHERE asset_id=$1', [id])
    ).rows[0];
    expect(document.tag_text).toContain('آزمایش');
    expect(document.title).toMatch(/^B05 original/);
    const d = (await detail(id)).json();
    expect(d.decisions[0]).toMatchObject({
      reviewerId: reviewer.id,
      reasonNote: 'Owned animation checked',
      priorState: 'PENDING',
    });
    expect(d.audit.at(-1).decisionId).toBe(d.decisions[0].id);
    const publicList = await app.inject('/api/v1/public/gifs');
    expect(publicList.statusCode).toBe(200);
    expect(
      publicList.json().items.some((item: { id: string }) => item.id === id),
    ).toBe(true);
    expect((await app.inject(`/api/v1/public/gifs/${id}`)).statusCode).toBe(
      200,
    );
    for (const path of [`/media/${id}/display.gif`, `/media/${id}/poster.png`])
      expect((await app.inject(path)).statusCode).toBe(200);
  });
  it('exact concurrent and sequential approval replay creates one decision/audit; changed semantics/actor/version conflict', async () => {
    const id = await fixture();
    const results = await Promise.all([decision(id), decision(id)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await decision(id)).statusCode).toBe(200);
    for (const r of [
      await decision(id, 'APPROVE', { reasonNote: 'different' }),
      await decision(id, 'APPROVE', {}, second),
      await decision(id, 'APPROVE', { expectedVersion: 2 }),
      await decision(id, 'REJECT'),
    ])
      expect(r.statusCode).toBe(409);
    expect(await snapshot(id)).toMatchObject({
      decisions: 1,
      audits: 1,
      documents: 1,
      row_version: '2',
    });
  });
  it('two different reviewers/decisions racing cannot both commit; stale expectedVersion returns 409', async () => {
    const id = await fixture();
    const r = await Promise.all([
      decision(id, 'APPROVE'),
      decision(id, 'REJECT', {}, second),
    ]);
    expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect(await snapshot(id)).toMatchObject({
      decisions: 1,
      audits: 1,
      row_version: '2',
    });
    const fresh = await fixture();
    expect(
      (await decision(fresh, 'APPROVE', { expectedVersion: 3 })).statusCode,
    ).toBe(409);
    expect(await snapshot(fresh)).toMatchObject({
      decisions: 0,
      audits: 0,
      row_version: '1',
    });
  });
  it('requires action-specific valid reasons, bounded notes, version and strict payload; enforces CSRF and Origin', async () => {
    const id = await fixture();
    for (const extra of [
      { reasonCode: '' },
      { reasonCode: 'UNKNOWN' },
      { reasonCode: 'POLICY_PASSED' },
      { reasonCode: undefined },
      { reasonNote: 'x'.repeat(2001) },
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { unexpected: true },
    ])
      expect((await decision(id, 'REJECT', extra)).statusCode).toBe(400);
    for (const badHeaders of [
      { ...headers(), origin: 'https://evil.test' },
      { ...headers(), 'x-csrf-token': 'wrong' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/review/assets/${id}/decision`,
            headers: badHeaders,
            payload: {
              decision: 'APPROVE',
              reasonCode: 'POLICY_PASSED',
              expectedVersion: 1,
            },
          })
        ).statusCode,
      ).toBe(403);
    expect(await snapshot(id)).toMatchObject({ decisions: 0, audits: 0 });
  });
  it('rejects missing processing/readiness/rights/derivative prerequisites without partial publication', async () => {
    for (const sql of [
      "UPDATE asset_states SET processing_state='RUNNING' WHERE asset_id=$1",
      "UPDATE asset_states SET delivery_readiness_state='NOT_READY' WHERE asset_id=$1",
      "UPDATE assets SET rights_attestation_version='' WHERE id=$1",
      "DELETE FROM asset_variants WHERE asset_id=$1 AND name='POSTER_PNG'",
      "UPDATE asset_variants SET object_version_id=NULL WHERE asset_id=$1 AND name='DISPLAY_GIF'",
      "UPDATE asset_variants SET frame_count=1 WHERE asset_id=$1 AND name='DISPLAY_GIF'",
    ]) {
      const id = await fixture();
      await pool.query(sql, [id]);
      expect((await decision(id)).statusCode).toBe(409);
      expect(await snapshot(id)).toMatchObject({
        decisions: 0,
        audits: 0,
        documents: 0,
        row_version: '1',
        visibility_state: 'PRIVATE',
      });
    }
  });
  it('verifies exact private derivative versions: latest overwrite does not replace preview; missing pinned output blocks approval', async () => {
    const id = await fixture();
    const v = (
      await pool.query(
        "SELECT * FROM asset_variants WHERE asset_id=$1 AND name='DISPLAY_GIF'",
        [id],
      )
    ).rows[0];
    const before = await app.inject({
      url: `/api/v1/review/assets/${id}/media/DISPLAY_GIF`,
      headers: headers(),
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_DERIVATIVES_BUCKET,
        Key: v.object_key,
        Body: Buffer.from('unsafe latest'),
        ContentType: 'image/gif',
      }),
    );
    const after = await app.inject({
      url: `/api/v1/review/assets/${id}/media/DISPLAY_GIF`,
      headers: headers(),
    });
    expect(after.statusCode).toBe(200);
    expect(after.rawPayload).toEqual(before.rawPayload);
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.S3_DERIVATIVES_BUCKET,
        Key: v.object_key,
        VersionId: v.object_version_id,
      }),
    );
    expect((await decision(id)).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/v1/review/assets/${id}/media/DISPLAY_GIF`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
    expect((await snapshot(id)).documents).toBe(0);
  });
  it('raw quarantine descriptor tampering is denied rather than serving the original', async () => {
    const id = await fixture();
    await pool.query(
      "UPDATE asset_variants SET object_key=(SELECT quarantine_key FROM upload_sessions WHERE asset_id=$1) WHERE asset_id=$1 AND name='DISPLAY_GIF'",
      [id],
    );
    expect((await decision(id)).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/v1/review/assets/${id}/media/DISPLAY_GIF`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
    expect((await detail(id)).json().previews).toEqual([]);
  });
  it('rejection atomically removes even a stale projection, preserves technical axes and is idempotent', async () => {
    const id = await fixture();
    await pool.query(
      "INSERT INTO search_documents(asset_id,title,tag_text) VALUES($1,'stale','')",
      [id],
    );
    const r = await decision(id, 'REJECT', {
      reasonCode: 'RIGHTS_CONCERN',
      reasonNote: 'Needs rights review',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().states).toMatchObject({
      moderation: 'REJECTED',
      visibility: 'RESTRICTED',
      searchEligibility: 'INELIGIBLE',
      apiAvailability: 'BLOCKED',
      indexing: 'NOT_INDEXED',
      processing: 'SUCCEEDED',
      deliveryReadiness: 'READY',
    });
    expect(
      (
        await decision(id, 'REJECT', {
          reasonCode: 'RIGHTS_CONCERN',
          reasonNote: 'Needs rights review',
        })
      ).statusCode,
    ).toBe(200);
    expect(await snapshot(id)).toMatchObject({
      decisions: 1,
      audits: 1,
      documents: 0,
    });
    expect(
      (await decision(id, 'APPROVE', { expectedVersion: 2 })).statusCode,
    ).toBe(409);
  });
  it('removal requires previous approval, keeps approval history, deletes projection and supports exact repeated REMOVE', async () => {
    const id = await fixture();
    expect(
      (await decision(id, 'REMOVE', { expectedVersion: 1 })).statusCode,
    ).toBe(409);
    await decision(id);
    expect(
      (await decision(id, 'REMOVE', { reasonCode: '', expectedVersion: 2 }))
        .statusCode,
    ).toBe(400);
    const r = await decision(id, 'REMOVE', { reasonCode: 'RIGHTS_REQUEST' });
    expect(r.statusCode).toBe(200);
    expect(r.json().states).toMatchObject({
      moderation: 'REMOVED',
      visibility: 'RESTRICTED',
      searchEligibility: 'INELIGIBLE',
      apiAvailability: 'BLOCKED',
      indexing: 'NOT_INDEXED',
      deliveryReadiness: 'READY',
    });
    expect(
      (await decision(id, 'REMOVE', { reasonCode: 'RIGHTS_REQUEST' }))
        .statusCode,
    ).toBe(200);
    expect((await decision(id)).statusCode).toBe(409);
    expect(await snapshot(id)).toMatchObject({
      decisions: 2,
      audits: 2,
      documents: 0,
      row_version: '3',
    });
    expect(
      (await detail(id))
        .json()
        .decisions.map((d: { action: string }) => d.action),
    ).toEqual(['APPROVE', 'REMOVE']);
  });
  it('audit insertion failure rolls back decision, states, version and projection for APPROVE, REJECT and REMOVE', async () => {
    for (const action of ['APPROVE', 'REJECT', 'REMOVE']) {
      const id = await fixture();
      if (action === 'REMOVE') await decision(id);
      const before = await snapshot(id);
      await pool.query(
        "CREATE FUNCTION b05_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type LIKE 'MODERATION_%' THEN RAISE EXCEPTION 'injected private failure'; END IF; RETURN NEW; END $$",
      );
      await pool.query(
        'CREATE TRIGGER b05_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION b05_fail_audit()',
      );
      try {
        const r = await decision(id, action);
        expect(r.statusCode).toBe(503);
        expect(r.body).not.toContain('injected');
        expect(await snapshot(id)).toEqual(before);
      } finally {
        await pool.query('DROP TRIGGER b05_fail_audit ON audit_events');
        await pool.query('DROP FUNCTION b05_fail_audit()');
      }
    }
  });
  it('dual-role owners cannot approve/reject/remove their own assets; revoked reviewer cannot decide', async () => {
    const id = await fixture(true, uploader);
    await pool.query(
      "INSERT INTO role_grants(user_id,role) VALUES($1,'REVIEWER')",
      [uploader.id],
    );
    try {
      for (const action of ['APPROVE', 'REJECT', 'REMOVE'])
        expect((await decision(id, action, {}, uploader)).statusCode).toBe(403);
    } finally {
      await pool.query(
        "DELETE FROM role_grants WHERE user_id=$1 AND role='REVIEWER'",
        [uploader.id],
      );
    }
    await pool.query(
      "DELETE FROM role_grants WHERE user_id=$1 AND role='REVIEWER'",
      [second.id],
    );
    try {
      expect((await decision(id, 'APPROVE', {}, second)).statusCode).toBe(403);
    } finally {
      await pool.query(
        "INSERT INTO role_grants(user_id,role) VALUES($1,'REVIEWER')",
        [second.id],
      );
    }
    expect((await snapshot(id)).decisions).toBe(0);
  });
  it('moderation decisions and audit history cannot be updated, deleted or truncated', async () => {
    for (const table of ['moderation_decisions', 'audit_events'])
      for (const sql of [
        `UPDATE ${table} SET id=id`,
        `DELETE FROM ${table}`,
        `TRUNCATE ${table}`,
      ])
        await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
  });
});
