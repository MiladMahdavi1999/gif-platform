import { randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import type { ProcessingErrorCode, VerifiedVariant } from '@gif/contracts';
export interface MediaLease {
  id: string;
  assetId: string;
  generation: number;
  token: string;
  attempt: number;
  key: string;
  versionId: string;
  etag: string;
  size: number;
}
export class StaleLease extends Error {
  constructor() {
    super('LEASE_LOST');
  }
}
export function createProcessingRepository(
  connectionString: string,
  maxAttempts: number,
  leaseSeconds: number,
) {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
  });
  pool.on('error', () => {});
  async function tx<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='2s'");
      const value = await run(c);
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function lock(c: PoolClient, lease: MediaLease) {
    const row = await c.query(
      `SELECT id FROM media_jobs WHERE id=$1 AND status='RUNNING'
      AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,
      [lease.id, lease.token],
    );
    if (!row.rowCount) throw new StaleLease();
  }
  async function finishJob(
    c: PoolClient,
    lease: MediaLease,
    status: string,
    code: string | null,
    delay: number,
  ) {
    const row = await c.query(
      `UPDATE media_jobs SET status=$3,last_error_code=$4,
      available_at=clock_timestamp()+make_interval(secs=>$5),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>clock_timestamp() RETURNING id`,
      [lease.id, lease.token, status, code, delay],
    );
    if (!row.rowCount) throw new StaleLease();
  }
  async function audit(
    c: PoolClient,
    assetId: string,
    type: string,
    metadata: object,
  ) {
    await c.query(
      'INSERT INTO audit_events(asset_id,event_type,metadata) VALUES($1,$2,$3)',
      [assetId, type, JSON.stringify(metadata)],
    );
  }
  return {
    async claim(): Promise<MediaLease | null> {
      return tx(async (c) => {
        const row = (
          await c.query(`SELECT j.id,j.asset_id AS "assetId",j.generation,j.attempt_count AS attempt,
          u.quarantine_key AS key,u.received_version_id AS "versionId",u.received_etag AS etag,u.received_size_bytes AS size
          FROM media_jobs j JOIN upload_sessions u ON u.asset_id=j.asset_id
          WHERE j.job_kind='PROCESS_GIF' AND ((j.status='READY' AND j.available_at<=clock_timestamp())
          OR (j.status='RUNNING' AND j.lease_until<=clock_timestamp()))
          ORDER BY j.available_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`)
        ).rows[0];
        if (!row) return null;
        if (row.attempt >= maxAttempts) {
          await c.query(
            `UPDATE media_jobs SET status='DEAD',lease_token=NULL,lease_until=NULL,
            last_error_code='ATTEMPTS_EXHAUSTED',updated_at=clock_timestamp() WHERE id=$1`,
            [row.id],
          );
          await c.query(
            `UPDATE asset_states SET processing_state='FAILED_TERMINAL',processing_error_code='ATTEMPTS_EXHAUSTED',
            state_updated_at=clock_timestamp() WHERE asset_id=$1`,
            [row.assetId],
          );
          await audit(c, row.assetId, 'PROCESSING_FAILED', {
            code: 'ATTEMPTS_EXHAUSTED',
            attempt: row.attempt,
          });
          return null;
        }
        const token = randomUUID();
        await c.query(
          `UPDATE media_jobs SET status='RUNNING',attempt_count=attempt_count+1,lease_token=$2,
          lease_until=clock_timestamp()+make_interval(secs=>$3),updated_at=clock_timestamp() WHERE id=$1`,
          [row.id, token, leaseSeconds],
        );
        await c.query(
          `UPDATE asset_states SET processing_state='RUNNING',processing_error_code=NULL,
          state_updated_at=clock_timestamp() WHERE asset_id=$1`,
          [row.assetId],
        );
        return {
          ...row,
          size: Number(row.size),
          token,
          attempt: row.attempt + 1,
        };
      });
    },
    async heartbeat(lease: MediaLease): Promise<boolean> {
      return Boolean(
        (
          await pool.query(
            `UPDATE media_jobs SET lease_until=clock_timestamp()+make_interval(secs=>$3),
        updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND status='RUNNING'
        AND lease_until>clock_timestamp() RETURNING id`,
            [lease.id, lease.token, leaseSeconds],
          )
        ).rowCount,
      );
    },
    async succeed(
      lease: MediaLease,
      variants: VerifiedVariant[],
      sourceSha256: string,
    ) {
      if (
        variants.length !== 2 ||
        new Set(variants.map((v) => v.name)).size !== 2
      )
        throw new Error('Invalid variants');
      await tx(async (c) => {
        await lock(c, lease);
        for (const v of variants) {
          await c.query(
            `INSERT INTO asset_variants(asset_id,rendition_version,name,object_key,object_version_id,mime_type,
            size_bytes,width,height,duration_ms,frame_count,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              lease.assetId,
              lease.generation,
              v.name,
              v.objectKey,
              v.objectVersionId,
              v.mimeType,
              v.sizeBytes,
              v.width,
              v.height,
              v.durationMs,
              v.frameCount,
              v.sha256,
            ],
          );
        }
        await c.query(
          `UPDATE asset_states SET processing_state='SUCCEEDED',delivery_readiness_state='READY',
          processing_error_code=NULL,state_updated_at=clock_timestamp() WHERE asset_id=$1`,
          [lease.assetId],
        );
        await c.query('SELECT public.processing_request_review($1)', [
          lease.assetId,
        ]);
        await audit(c, lease.assetId, 'PROCESSING_SUCCEEDED', {
          attempt: lease.attempt,
          sourceSha256,
        });
        await finishJob(c, lease, 'DONE', null, 0);
      });
    },
    async fail(
      lease: MediaLease,
      code: ProcessingErrorCode,
      retryable: boolean,
    ) {
      const retry = retryable && lease.attempt < maxAttempts;
      // Provisional capped exponential delay with bounded jitter, persisted in PG.
      const delay =
        Math.min(300, 2 ** Math.min(lease.attempt, 8)) + Math.random();
      await tx(async (c) => {
        await lock(c, lease);
        await c.query(
          `UPDATE asset_states SET processing_state=$2,processing_error_code=$3,
          state_updated_at=clock_timestamp() WHERE asset_id=$1`,
          [lease.assetId, retry ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL', code],
        );
        if (!retry)
          await audit(c, lease.assetId, 'PROCESSING_FAILED', {
            code,
            attempt: lease.attempt,
          });
        await finishJob(c, lease, retry ? 'READY' : 'DEAD', code, delay);
      });
    },
    close: () => pool.end(),
  };
}
export type ProcessingRepository = ReturnType<
  typeof createProcessingRepository
>;
