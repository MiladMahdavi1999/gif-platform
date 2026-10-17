import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase } from './dev.js';
import {
  createProcessingRepository,
  StaleLease,
  type MediaLease,
} from './processing.js';
import { provisionDevelopmentWorker } from './worker-access.js';
import type { VerifiedVariant } from '@gif/contracts';
import { createOperationsRepository } from './operations.js';
if (
  process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  process.env.APP_ENV === 'production'
)
  throw new Error('Explicit local database integration opt-in required');
const source = new URL(process.env.TEST_DATABASE_URL ?? '');
assertDevelopmentDatabase({
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: source.href,
});
if (!source.pathname.endsWith('_test'))
  throw new Error('Disposable integration database required');
const name = `gif_platform_b04lease_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const worker = new URL(target);
worker.username = 'gif_processing_worker';
worker.password = 'local_only_lease_worker_password';
const admin = new pg.Pool({ connectionString: source.href });
const pool = new pg.Pool({ connectionString: target.href });
const repo = createProcessingRepository(worker.href, 2, 3);
const second = createProcessingRepository(worker.href, 2, 3);
let owner: string;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  const c = await pool.connect();
  try {
    await migrate(c);
  } finally {
    c.release();
  }
  await provisionDevelopmentWorker({
    NODE_ENV: 'development',
    APP_ENV: 'development',
    ALLOW_DEV_DATABASE_COMMANDS: 'true',
    DATABASE_URL: target.href,
    WORKER_DATABASE_URL: worker.href,
  });
  owner = (
    await pool.query(
      "INSERT INTO users(email,password_hash) VALUES('lease@local.test','unused') RETURNING id",
    )
  ).rows[0].id;
});
afterAll(async () => {
  await repo.close();
  await second.close();
  await pool.end();
  await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
});
async function job() {
  const id = randomUUID();
  const upload = randomUUID();
  await pool.query(
    "INSERT INTO assets(id,owner_id,kind,title,rights_attested_at,rights_attestation_version) VALUES($1,$2,'GIF','lease test',now(),'v1')",
    [id, owner],
  );
  await pool.query(
    "INSERT INTO asset_states(asset_id,upload_state,processing_state) VALUES($1,'RECEIVED','QUEUED')",
    [id],
  );
  await pool.query(
    "INSERT INTO upload_sessions(id,asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,received_size_bytes,received_etag,received_version_id,expires_at,completed_at) VALUES($1::uuid,$2,$3,$1::text,$1::text,'image/gif',85,'etag','pinned-version',now(),now())",
    [upload, id, owner],
  );
  await pool.query(
    "INSERT INTO media_jobs(asset_id,job_kind) VALUES($1,'PROCESS_GIF')",
    [id],
  );
  return id;
}
const outputs = (id: string): VerifiedVariant[] => [
  {
    name: 'DISPLAY_GIF',
    objectKey: `assets/${id}/display`,
    objectVersionId: 'version-gif',
    mimeType: 'image/gif',
    sizeBytes: 99,
    width: 1,
    height: 1,
    frameCount: 2,
    durationMs: 200,
    sha256: 'a'.repeat(64),
  },
  {
    name: 'POSTER_PNG',
    objectKey: `assets/${id}/poster`,
    objectVersionId: 'version-png',
    mimeType: 'image/png',
    sizeBytes: 90,
    width: 1,
    height: 1,
    frameCount: 1,
    durationMs: null,
    sha256: 'b'.repeat(64),
  },
];
async function expire(lease: MediaLease) {
  await pool.query(
    "UPDATE media_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [lease.id],
  );
}
async function dead(lease: MediaLease) {
  await repo.fail(lease, 'MEDIA_INVALID', false);
}
describe('B04 leases on real PostgreSQL with restricted worker identity', () => {
  it('B08 read-only diagnostics identify backoff, real expired leases and terminal failures without leaking internals', async () => {
    const id = await job();
    const lease = (await repo.claim())!;
    await repo.fail(lease, 'STORAGE_TEMPORARY', true);
    const ops = createOperationsRepository(target.href);
    try {
      expect(
        (await ops.inspect()).jobs.find((j) => j.assetId === id),
      ).toMatchObject({
        code: 'STORAGE_TEMPORARY',
        action: 'WAIT_FOR_BACKOFF',
      });
      await pool.query(
        'UPDATE media_jobs SET available_at=clock_timestamp() WHERE id=$1',
        [lease.id],
      );
      expect(
        (await ops.inspect()).jobs.find((j) => j.assetId === id)?.action,
      ).toBe('AUTOMATIC_RETRY');
      const next = (await repo.claim())!;
      await new Promise((r) => setTimeout(r, 3100));
      expect(
        (await ops.inspect()).jobs.find((j) => j.assetId === id)?.action,
      ).toBe('AUTOMATIC_LEASE_RECOVERY');
      expect((await ops.references(id)).protectScope).toBe(true);
      expect(await repo.claim()).toBeNull();
      expect(
        (await ops.inspect()).jobs.find((j) => j.assetId === id),
      ).toMatchObject({
        code: 'ATTEMPTS_EXHAUSTED',
        action: 'MANUAL_INVESTIGATION',
      });
      await pool.query('UPDATE media_jobs SET last_error_code=$2 WHERE id=$1', [
        next.id,
        'secret /tmp/private decoder',
      ]);
      await pool.query(
        "UPDATE asset_states SET delivery_readiness_state='DEGRADED' WHERE asset_id=$1",
        [id],
      );
      const result = await ops.inspect();
      expect(result.jobs.find((j) => j.assetId === id)?.code).toBe(
        'UNKNOWN_FAILURE',
      );
      expect(result.degradedMedia.find((d) => d.assetId === id)?.action).toBe(
        'MANUAL_INVESTIGATION',
      );
      expect(JSON.stringify(result)).not.toMatch(
        /secret|tmp|decoder|lease_token|quarantine|password|@local/,
      );
      await expect(ops.references('../')).rejects.toThrow();
    } finally {
      await ops.close();
    }
  });
  it('atomic SKIP LOCKED claim across independent pools, then fenced transaction updates only technical states', async () => {
    const id = await job();
    const leases = await Promise.all([repo.claim(), second.claim()]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const lease = leases.find(Boolean)!;
    expect(lease.versionId).toBe('pinned-version');
    const completions = await Promise.allSettled([
      repo.succeed(lease, outputs(id), 'c'.repeat(64)),
      second.succeed(lease, outputs(id), 'c'.repeat(64)),
    ]);
    expect(completions.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(
      completions.filter(
        (v) => v.status === 'rejected' && v.reason instanceof StaleLease,
      ),
    ).toHaveLength(1);
    expect(
      (await pool.query('SELECT * FROM asset_states WHERE asset_id=$1', [id]))
        .rows[0],
    ).toMatchObject({
      processing_state: 'SUCCEEDED',
      delivery_readiness_state: 'READY',
      moderation_state: 'PENDING',
      visibility_state: 'PRIVATE',
      search_eligibility_state: 'INELIGIBLE',
      api_availability_state: 'BLOCKED',
      indexing_state: 'NOT_INDEXED',
    });
    await expect(
      repo.succeed(lease, outputs(id), 'c'.repeat(64)),
    ).rejects.toBeInstanceOf(StaleLease);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM asset_variants WHERE asset_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it('heartbeat extends lease, expiry invalidates heartbeat and stale failure and completion', async () => {
    const id = await job();
    const lease = (await repo.claim())!;
    const before = (
      await pool.query('SELECT lease_until FROM media_jobs WHERE id=$1', [
        lease.id,
      ])
    ).rows[0].lease_until;
    await new Promise((r) => setTimeout(r, 20));
    expect(await repo.heartbeat(lease)).toBe(true);
    expect(
      (
        await pool.query('SELECT lease_until FROM media_jobs WHERE id=$1', [
          lease.id,
        ])
      ).rows[0].lease_until.getTime(),
    ).toBeGreaterThan(before.getTime());
    await expire(lease);
    expect(await repo.heartbeat(lease)).toBe(false);
    await expect(dead(lease)).rejects.toBeInstanceOf(StaleLease);
    await expect(
      repo.succeed(lease, outputs(id), 'c'.repeat(64)),
    ).rejects.toBeInstanceOf(StaleLease);
    const next = (await second.claim())!;
    expect(next.token).not.toBe(lease.token);
    expect(next.attempt).toBe(2);
    await dead(next);
  });
  it('persists bounded exponential retry and terminal state at max attempts', async () => {
    const id = await job();
    let lease = (await repo.claim())!;
    await repo.fail(lease, 'STORAGE_TEMPORARY', true);
    const failed = (
      await pool.query('SELECT * FROM media_jobs WHERE id=$1', [lease.id])
    ).rows[0];
    expect(failed.status).toBe('READY');
    expect(failed.available_at.getTime() - Date.now()).toBeGreaterThan(0);
    expect(failed.available_at.getTime() - Date.now()).toBeLessThan(3100);
    expect(await repo.claim()).toBeNull();
    await pool.query(
      'UPDATE media_jobs SET available_at=clock_timestamp() WHERE id=$1',
      [lease.id],
    );
    lease = (await repo.claim())!;
    await repo.fail(lease, 'STORAGE_TEMPORARY', true);
    expect(
      (
        await pool.query(
          'SELECT processing_state FROM asset_states WHERE asset_id=$1',
          [id],
        )
      ).rows[0].processing_state,
    ).toBe('FAILED_TERMINAL');
    expect(await repo.claim()).toBeNull();
  });
  it('recovers expired final crashed attempt into DEAD rather than remaining RUNNING', async () => {
    const id = await job();
    for (let i = 0; i < 2; i++) {
      const lease = (await repo.claim())!;
      await expire(lease);
    }
    expect(await repo.claim()).toBeNull();
    expect(
      (
        await pool.query(
          'SELECT status,attempt_count,last_error_code FROM media_jobs WHERE asset_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({
      status: 'DEAD',
      attempt_count: 2,
      last_error_code: 'ATTEMPTS_EXHAUSTED',
    });
  });
  it('rolls back every success mutation on audit failure and accepts recovery with the still-valid token', async () => {
    const id = await job();
    const lease = (await repo.claim())!;
    await pool.query(
      "CREATE FUNCTION b04_lease_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'safe injected failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER b04_lease_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION b04_lease_audit_fail()',
    );
    try {
      await expect(
        repo.succeed(lease, outputs(id), 'c'.repeat(64)),
      ).rejects.toThrow();
    } finally {
      await pool.query('DROP TRIGGER b04_lease_audit_fail ON audit_events');
      await pool.query('DROP FUNCTION b04_lease_audit_fail()');
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM asset_variants WHERE asset_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT processing_state,moderation_state FROM asset_states WHERE asset_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({
      processing_state: 'RUNNING',
      moderation_state: 'NOT_REQUESTED',
    });
    await repo.succeed(lease, outputs(id), 'c'.repeat(64));
  });
  it('database denies approval, publication, indexing, original pin changes and session reads', async () => {
    const limited = new pg.Pool({ connectionString: worker.href });
    try {
      for (const sql of [
        "UPDATE asset_states SET moderation_state='APPROVED'",
        "UPDATE asset_states SET visibility_state='PUBLIC'",
        'DELETE FROM search_documents',
        "UPDATE upload_sessions SET received_version_id='unsafe'",
        'SELECT * FROM sessions',
        "UPDATE role_grants SET role='ADMIN'",
      ])
        await expect(limited.query(sql)).rejects.toMatchObject({
          code: '42501',
        });
    } finally {
      await limited.end();
    }
  });
});
