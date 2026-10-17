import { createResilientPool } from './pool.js';
import type { PoolClient } from 'pg';
import { processingErrorCodes } from '@gif/contracts';
import { assetIdSchema } from '@gif/contracts';

const safeCode = (value: string | null) =>
  value === null
    ? null
    : processingErrorCodes.includes(value as never)
      ? value
      : 'UNKNOWN_FAILURE';
const safeRequest = (value: string | null) =>
  value && /^(?:[a-f0-9-]{36}|req-[a-z0-9]+)$/.test(value) ? value : null;

/** Shell/DB-authorized, bounded, read-only diagnostics. No HTTP route or mutation. */
export function createOperationsRepository(connectionString: string) {
  const pool = createResilientPool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1500,
    query_timeout: 5500,
    statement_timeout: 5000,
  });
  async function snapshot<T>(run: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value = await run(c);
      await c.query('COMMIT');
      return value;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }
  return {
    async inspect() {
      return snapshot(async (c) => {
        const jobs =
          await c.query(`SELECT j.id AS "jobId",j.asset_id AS "assetId",j.status,
          j.attempt_count AS attempt,j.available_at AS "availableAt",j.lease_until AS "leaseUntil",
          j.last_error_code AS code,
          CASE WHEN j.status='DEAD' THEN 'MANUAL_INVESTIGATION'
            WHEN j.status='RUNNING' AND j.lease_until IS NULL THEN 'MANUAL_INVESTIGATION'
            WHEN j.status='RUNNING' AND j.lease_until<=now() THEN 'AUTOMATIC_LEASE_RECOVERY'
            WHEN j.status='READY' AND j.available_at>now() THEN 'WAIT_FOR_BACKOFF'
            WHEN j.status='READY' THEN 'AUTOMATIC_RETRY' ELSE 'WAIT_FOR_LEASE' END AS action,
          (SELECT request_id FROM audit_events e WHERE e.asset_id=j.asset_id AND e.event_type='UPLOAD_RECEIVED'
            ORDER BY created_at DESC,id DESC LIMIT 1) AS "requestId"
          FROM media_jobs j WHERE j.status<>'DONE' ORDER BY j.updated_at,j.id LIMIT 101`);
        const delivery =
          await c.query(`SELECT s.asset_id AS "assetId",s.moderation_state AS moderation,
          s.delivery_readiness_state AS readiness,
          (SELECT request_id FROM audit_events e WHERE e.asset_id=s.asset_id AND e.event_type='DELIVERY_DEGRADED'
            ORDER BY created_at DESC,id DESC LIMIT 1) AS "requestId"
          FROM asset_states s WHERE s.delivery_readiness_state='DEGRADED'
          ORDER BY s.state_updated_at,s.asset_id LIMIT 101`);
        return {
          generatedAt: new Date().toISOString(),
          readOnly: true,
          jobs: jobs.rows.slice(0, 100).map((j) => ({
            ...j,
            code: safeCode(j.code),
            requestId: safeRequest(j.requestId),
          })),
          degradedMedia: delivery.rows.slice(0, 100).map((r) => ({
            ...r,
            requestId: safeRequest(r.requestId),
            action: 'MANUAL_INVESTIGATION',
          })),
          truncated: jobs.rows.length > 100 || delivery.rows.length > 100,
        };
      });
    },
    async references(assetId: string) {
      assetId = assetIdSchema.parse(assetId).toLowerCase();
      return snapshot(async (c) => {
        // All generations and pins, including rejected/removed content, stay protected.
        const variants = await c.query(
          'SELECT object_key FROM asset_variants WHERE asset_id=$1 LIMIT 101',
          [assetId],
        );
        const uploads = await c.query(
          'SELECT quarantine_key FROM upload_sessions WHERE asset_id=$1 LIMIT 101',
          [assetId],
        );
        const jobs = await c.query(
          'SELECT 1 FROM media_jobs WHERE asset_id=$1 LIMIT 1',
          [assetId],
        );
        const active = await c.query(
          `SELECT 1 FROM upload_sessions WHERE asset_id=$1
          AND (completed_at IS NOT NULL OR expires_at>clock_timestamp()) LIMIT 1`,
          [assetId],
        );
        return {
          keys: [
            ...variants.rows.map((r) => r.object_key as string),
            ...uploads.rows.map((r) => r.quarantine_key as string),
          ],
          protectScope: Boolean(
            jobs.rowCount ||
            active.rowCount ||
            variants.rows.length > 100 ||
            uploads.rows.length > 100,
          ),
        };
      });
    },
    close: () => pool.end(),
  };
}
