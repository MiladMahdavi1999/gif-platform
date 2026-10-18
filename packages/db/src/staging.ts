import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { PoolClient } from 'pg';

export function assertStaging(env: NodeJS.ProcessEnv) {
  if (env.APP_ENV !== 'staging' || env.NODE_ENV !== 'production')
    throw new Error('Explicit staging production mode required');
  const url = new URL(env.DATABASE_URL ?? '');
  if (url.hostname !== 'db' || url.pathname !== '/gif_platform_staging')
    throw new Error('Local staging database required');
}

/** Operator-only provisioning; the worker grants match B04/B08, never publication. */
export async function provisionStagingRoles(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
) {
  assertStaging(env);
  if (env.ALLOW_STAGING_PROVISION !== 'true')
    throw new Error('Explicit provisioning required');
  const entries = [
    ['gif_staging_api', env.API_DATABASE_URL],
    ['gif_processing_worker', env.WORKER_DATABASE_URL],
  ] as const;
  for (const [name, value] of entries) {
    const url = new URL(value ?? '');
    if (
      url.username !== name ||
      url.hostname !== 'db' ||
      url.pathname !== '/gif_platform_staging' ||
      decodeURIComponent(url.password).length < 32
    )
      throw new Error('Invalid staging database identity');
  }
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71401, 2)');
    for (const [name, value] of entries) {
      if (
        !(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name]))
          .rowCount
      )
        await client.query(
          `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        );
      // Do not adopt an unexpectedly privileged existing role.
      const role = (
        await client.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',
          [name],
        )
      ).rows[0];
      if (Object.values(role).some(Boolean))
        throw new Error('Unsafe existing role');
      const password = decodeURIComponent(new URL(value!).password);
      const sql = (
        await client.query(
          "SELECT format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text) AS sql",
          [name, password],
        )
      ).rows[0].sql;
      await client.query(sql);
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO gif_staging_api, gif_processing_worker;
      GRANT SELECT ON users,role_grants,sessions,assets,asset_states,upload_sessions,tags,asset_tags,asset_variants,media_jobs,moderation_decisions,search_documents,audit_events TO gif_staging_api;
      GRANT INSERT ON sessions,assets,asset_states,upload_sessions,tags,asset_tags,media_jobs,moderation_decisions,search_documents,audit_events TO gif_staging_api;
      GRANT UPDATE ON sessions,assets,asset_states,upload_sessions,tags,search_documents TO gif_staging_api;
      GRANT DELETE ON search_documents TO gif_staging_api;
      GRANT SELECT ON media_jobs,upload_sessions,asset_states,asset_variants TO gif_processing_worker;
      GRANT UPDATE(status,attempt_count,available_at,lease_until,lease_token,last_error_code,updated_at) ON media_jobs TO gif_processing_worker;
      GRANT UPDATE(processing_state,processing_error_code,delivery_readiness_state,state_updated_at) ON asset_states TO gif_processing_worker;
      GRANT INSERT ON asset_variants,audit_events TO gif_processing_worker;
      GRANT EXECUTE ON FUNCTION public.processing_request_review(uuid) TO gif_processing_worker;`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Explicit identities only; no default credentials, password rotation or implicit seed. */
export async function bootstrapStagingIdentities(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
) {
  assertStaging(env);
  if (env.ALLOW_STAGING_BOOTSTRAP !== 'true')
    throw new Error('Explicit bootstrap authorization required');
  const accounts = ['UPLOADER', 'REVIEWER'].map((role) => ({
    role,
    email: env[`BOOTSTRAP_${role}_EMAIL`],
    password: env[`BOOTSTRAP_${role}_PASSWORD`],
  }));
  if (
    accounts.some(
      (a) =>
        !a.email ||
        a.email !== a.email.trim().toLowerCase() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) ||
        !a.password ||
        a.password.length < 32,
    ) ||
    accounts[0]!.email === accounts[1]!.email ||
    accounts[0]!.password === accounts[1]!.password
  )
    throw new Error('Distinct explicit staging identities required');
  const hashes = await Promise.all(
    accounts.map((a) =>
      hash(a.password!, {
        algorithm: Algorithm.Argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    ),
  );
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71401, 3)');
    for (const [index, account] of accounts.entries()) {
      const existing = (
        await client.query(
          'SELECT id,password_hash,status FROM users WHERE email=$1',
          [account.email],
        )
      ).rows[0];
      if (
        existing &&
        (existing.status !== 'ACTIVE' ||
          !(await verify(existing.password_hash, account.password!)))
      )
        throw new Error('Existing identity conflict');
      const id =
        existing?.id ??
        (
          await client.query(
            'INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id',
            [account.email, hashes[index]],
          )
        ).rows[0].id;
      const grants = (
        await client.query('SELECT role FROM role_grants WHERE user_id=$1', [
          id,
        ])
      ).rows;
      if (grants.some((g) => g.role !== account.role))
        throw new Error('Staging role separation conflict');
      await client.query(
        'INSERT INTO role_grants(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [id, account.role],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
