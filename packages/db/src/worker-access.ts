import pg from 'pg';
import { assertDevelopmentDatabase } from './dev.js';
/** Explicit local bootstrap; production role provisioning remains operator-owned. */
export async function provisionDevelopmentWorker(env: NodeJS.ProcessEnv) {
  assertDevelopmentDatabase(env);
  const api = new URL(env.DATABASE_URL!);
  const worker = new URL(env.WORKER_DATABASE_URL ?? '');
  if (
    worker.username !== 'gif_processing_worker' ||
    worker.hostname !== api.hostname ||
    worker.port !== api.port ||
    worker.pathname !== api.pathname ||
    decodeURIComponent(worker.password).length < 16
  )
    throw new Error('Invalid development worker database configuration');
  const client = new pg.Client({ connectionString: api.href });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71401,2)');
    if (
      !(
        await client.query(
          "SELECT 1 FROM pg_roles WHERE rolname='gif_processing_worker'",
        )
      ).rowCount
    )
      await client.query(
        'CREATE ROLE gif_processing_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
    const sql = (
      await client.query(
        "SELECT format('ALTER ROLE gif_processing_worker PASSWORD %L',$1::text) AS sql",
        [decodeURIComponent(worker.password)],
      )
    ).rows[0].sql;
    await client.query(sql);
    await client.query(`GRANT USAGE ON SCHEMA public TO gif_processing_worker;
      GRANT SELECT ON media_jobs,upload_sessions,asset_states,asset_variants TO gif_processing_worker;
      GRANT UPDATE(status,attempt_count,available_at,lease_until,lease_token,last_error_code,updated_at) ON media_jobs TO gif_processing_worker;
      GRANT UPDATE(processing_state,processing_error_code,delivery_readiness_state,state_updated_at) ON asset_states TO gif_processing_worker;
      GRANT INSERT ON asset_variants,audit_events TO gif_processing_worker;
      GRANT EXECUTE ON FUNCTION public.processing_request_review(uuid) TO gif_processing_worker;`);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Worker database provisioning failed');
  } finally {
    await client.end();
  }
}
