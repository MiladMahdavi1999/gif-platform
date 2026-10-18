import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase } from './dev.js';
import {
  bootstrapStagingIdentities,
  provisionStagingRoles,
} from './staging.js';
if (process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true')
  throw new Error('Explicit integration opt-in required');
const source = new URL(process.env.TEST_DATABASE_URL ?? '');
assertDevelopmentDatabase({
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: source.href,
});
if (!source.pathname.endsWith('_test'))
  throw new Error('Disposable test DB required');
const database = `gif_platform_b09_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${database}`;
const admin = new pg.Pool({ connectionString: source.href });
const pool = new pg.Pool({ connectionString: target.href });
const env = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  DATABASE_URL: 'postgresql://admin:unused@db/gif_platform_staging',
  BOOTSTRAP_UPLOADER_EMAIL: 'uploader@staging.invalid',
  BOOTSTRAP_REVIEWER_EMAIL: 'reviewer@staging.invalid',
  BOOTSTRAP_UPLOADER_PASSWORD: 'a'.repeat(64),
  BOOTSTRAP_REVIEWER_PASSWORD: 'b'.repeat(64),
  ALLOW_STAGING_BOOTSTRAP: 'true',
  ALLOW_STAGING_PROVISION: 'true',
  API_DATABASE_URL: `postgresql://gif_staging_api:${'c'.repeat(64)}@db/gif_platform_staging`,
  WORKER_DATABASE_URL: `postgresql://gif_processing_worker:${'d'.repeat(64)}@db/gif_platform_staging`,
};
let client: pg.PoolClient;
let created = false;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  client = await pool.connect();
  await migrate(client);
});
afterAll(async () => {
  client?.release();
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
});
it('does not seed identities during migration or role provisioning', async () => {
  await provisionStagingRoles(client, env);
  expect((await client.query('SELECT count(*) FROM users')).rows[0].count).toBe(
    '0',
  );
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE gif_processing_worker');
    await expect(
      client.query("UPDATE asset_states SET visibility_state='PUBLIC'"),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await client.query('ROLLBACK');
  }
});
it('requires explicit bootstrap authorization and distinct role identities', async () => {
  await expect(
    bootstrapStagingIdentities(client, {
      ...env,
      ALLOW_STAGING_BOOTSTRAP: 'false',
    }),
  ).rejects.toThrow('authorization');
  await expect(
    bootstrapStagingIdentities(client, {
      ...env,
      BOOTSTRAP_REVIEWER_EMAIL: env.BOOTSTRAP_UPLOADER_EMAIL,
    }),
  ).rejects.toThrow('Distinct');
  expect((await client.query('SELECT count(*) FROM users')).rows[0].count).toBe(
    '0',
  );
});
it('bootstraps idempotently without changing hashes or creating content', async () => {
  await bootstrapStagingIdentities(client, env);
  const before = (await client.query('SELECT * FROM users ORDER BY id')).rows;
  await bootstrapStagingIdentities(client, env);
  expect((await client.query('SELECT * FROM users ORDER BY id')).rows).toEqual(
    before,
  );
  expect(before).toHaveLength(2);
  expect(
    (await client.query('SELECT count(*) FROM assets')).rows[0].count,
  ).toBe('0');
});
it('refuses password and role conflicts without granting self-approval', async () => {
  await expect(
    bootstrapStagingIdentities(client, {
      ...env,
      BOOTSTRAP_UPLOADER_PASSWORD: 'e'.repeat(64),
    }),
  ).rejects.toThrow('conflict');
  const id = (
    await client.query('SELECT id FROM users WHERE email=$1', [
      env.BOOTSTRAP_UPLOADER_EMAIL,
    ])
  ).rows[0].id;
  await client.query("INSERT INTO role_grants VALUES($1,'REVIEWER')", [id]);
  await expect(bootstrapStagingIdentities(client, env)).rejects.toThrow(
    'separation',
  );
  await client.query(
    "DELETE FROM role_grants WHERE user_id=$1 AND role='REVIEWER'",
    [id],
  );
  expect(
    (await client.query('SELECT role FROM role_grants WHERE user_id=$1', [id]))
      .rows,
  ).toEqual([{ role: 'UPLOADER' }]);
});
it('API cannot mutate audit history, credentials, roles or schema', async () => {
  for (const sql of [
    "UPDATE audit_events SET event_type='FORGED'",
    "UPDATE users SET password_hash='FORGED'",
    "INSERT INTO role_grants SELECT id,'ADMIN' FROM users",
    'CREATE TABLE forged(id integer)',
  ]) {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE gif_staging_api');
      await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
    }
  }
});
