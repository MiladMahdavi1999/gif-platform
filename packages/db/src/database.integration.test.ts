import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import pg from 'pg';
import { verify } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrationDirectory } from './migrate.js';
import {
  assertDevelopmentDatabase,
  inspectDevelopment,
  seedDevelopment,
} from './dev.js';
import { resetDevelopment } from './reset.js';

// Fail closed: never silently skip integration tests and never touch the app DB.
if (
  process.env.NODE_ENV === 'production' ||
  process.env.APP_ENV === 'production' ||
  process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true'
)
  throw new Error('Explicit local integration test opt-in is required');
const sourceUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
const baseEnv = {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: sourceUrl.href,
};
assertDevelopmentDatabase(baseEnv);
if (!sourceUrl.pathname.endsWith('_test'))
  throw new Error('Integration database must end in _test');
const database = `gif_platform_b01_${randomUUID().replaceAll('-', '')}_test`;
const databaseUrl = new URL(sourceUrl);
databaseUrl.pathname = `/${database}`;
const admin = new pg.Pool({ connectionString: sourceUrl.href });
const pool = new pg.Pool({ connectionString: databaseUrl.href });
const devEnv = {
  ...baseEnv,
  DATABASE_URL: databaseUrl.href,
  DEV_UPLOADER_EMAIL: 'uploader@local.test',
  DEV_UPLOADER_PASSWORD: 'local_integration_uploader_password',
  DEV_REVIEWER_EMAIL: 'reviewer@local.test',
  DEV_REVIEWER_PASSWORD: 'local_integration_reviewer_password',
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

async function fixture() {
  const user = (
    await client.query(
      "INSERT INTO users(email,password_hash) VALUES($1,'fixture-only') RETURNING id",
      [`${randomUUID()}@local.test`],
    )
  ).rows[0].id as string;
  const asset = (
    await client.query(
      "INSERT INTO assets(owner_id,kind,title,rights_attested_at,rights_attestation_version) VALUES($1,'GIF','Owned test pixels',now(),'local-v1') RETURNING id",
      [user],
    )
  ).rows[0].id as string;
  const tag = (
    await client.query('INSERT INTO tags(slug) VALUES($1) RETURNING id', [
      randomUUID(),
    ])
  ).rows[0].id as string;
  return { user, asset, tag };
}
async function rejectSql(query: string, values: unknown[], code: string) {
  await client.query('SAVEPOINT negative');
  try {
    await expect(client.query(query, values)).rejects.toMatchObject({ code });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT negative');
  }
}
async function transaction(run: () => Promise<void>) {
  await client.query('BEGIN');
  try {
    await run();
  } finally {
    await client.query('ROLLBACK');
  }
}
async function temporaryMigrations(run: (directory: URL) => Promise<void>) {
  await mkdir('work', { recursive: true });
  const path = await mkdtemp('work/b01-migrations-');
  const url = pathToFileURL(`${process.cwd()}/${path}/`);
  try {
    await cp(migrationDirectory, url, { recursive: true });
    await run(url);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

describe('B01 real PostgreSQL', () => {
  it('creates all core tables, defaults, foreign keys and required indexes on PostgreSQL 17', async () => {
    expect(
      (await client.query('SHOW server_version_num')).rows[0]
        .server_version_num,
    ).toMatch(/^17/);
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    expect(tables).toEqual([
      'asset_states',
      'asset_tags',
      'asset_variants',
      'assets',
      'audit_events',
      'media_jobs',
      'moderation_decisions',
      'role_grants',
      'search_documents',
      'sessions',
      'tags',
      'upload_sessions',
      'users',
    ]);
    const indexes = (
      await client.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
      )
    ).rows;
    for (const name of [
      'sessions_valid_idx',
      'assets_owner_created_idx',
      'asset_tags_tag_idx',
      'states_moderation_idx',
      'upload_sessions_exp_idx',
      'moderation_asset_time_idx',
      'search_docs_fts_idx',
      'jobs_due_idx',
      'audit_asset_created_idx',
    ])
      expect(indexes.some((r) => r.indexname === name)).toBe(true);
    expect(
      indexes.find((r) => r.indexname === 'sessions_valid_idx').indexdef,
    ).toContain('WHERE (revoked_at IS NULL)');
    expect(
      indexes.find((r) => r.indexname === 'upload_sessions_exp_idx').indexdef,
    ).toContain('WHERE (completed_at IS NULL)');
    await transaction(async () => {
      const { asset } = await fixture();
      const state = (
        await client.query(
          'INSERT INTO asset_states(asset_id) VALUES($1) RETURNING *',
          [asset],
        )
      ).rows[0];
      expect(state).toMatchObject({
        upload_state: 'INTENT',
        processing_state: 'NOT_STARTED',
        visibility_state: 'PRIVATE',
        search_eligibility_state: 'INELIGIBLE',
        indexing_state: 'NOT_INDEXED',
        api_availability_state: 'BLOCKED',
        delivery_readiness_state: 'NOT_READY',
        moderation_state: 'NOT_REQUESTED',
      });
    });
  });

  it('migrates and seeds twice without replacing hashes, roles or user IDs; leaves zero assets', async () => {
    await seedDevelopment(client, devEnv);
    const before = await client.query('SELECT * FROM users ORDER BY email');
    const ledger = await client.query(
      'SELECT * FROM gif_migrations.history ORDER BY position',
    );
    await migrate(client);
    await seedDevelopment(client, devEnv);
    expect(
      (await client.query('SELECT * FROM users ORDER BY email')).rows,
    ).toEqual(before.rows);
    expect(
      (
        await client.query(
          'SELECT * FROM gif_migrations.history ORDER BY position',
        )
      ).rows,
    ).toEqual(ledger.rows);
    expect(before.rowCount).toBe(2);
    for (const row of before.rows) {
      expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(
        await verify(
          row.password_hash,
          row.email === devEnv.DEV_UPLOADER_EMAIL
            ? devEnv.DEV_UPLOADER_PASSWORD
            : devEnv.DEV_REVIEWER_PASSWORD,
        ),
      ).toBe(true);
      expect(await verify(row.password_hash, 'incorrect')).toBe(false);
    }
    const inspection = await inspectDevelopment(client, devEnv);
    expect(inspection.assetCount).toBe(0);
    expect(inspection.accounts).toHaveLength(2);
    expect(new Set(inspection.accounts.map((a) => a.id)).size).toBe(2);
    expect(inspection.accounts.map((a) => a.role).sort()).toEqual([
      'REVIEWER',
      'UPLOADER',
    ]);
  });

  it('rejects seed role conflicts transactionally', async () => {
    const reviewer = (
      await client.query('SELECT id FROM users WHERE email=$1', [
        devEnv.DEV_REVIEWER_EMAIL,
      ])
    ).rows[0].id;
    await client.query("INSERT INTO role_grants VALUES($1,'UPLOADER')", [
      reviewer,
    ]);
    try {
      await expect(seedDevelopment(client, devEnv)).rejects.toThrow(
        'Seed role separation conflict',
      );
    } finally {
      await client.query(
        "DELETE FROM role_grants WHERE user_id=$1 AND role='UPLOADER'",
        [reviewer],
      );
    }
  });

  it('enforces every foreign key and the documented delete behavior', async () =>
    transaction(async () => {
      const { user, asset, tag } = await fixture();
      // Valid minimal rows for each table owning a FK; substitute each FK independently.
      const rows: Record<string, Record<string, unknown>> = {
        role_grants: { user_id: user, role: 'UPLOADER' },
        sessions: {
          user_id: user,
          token_hash: Buffer.from('a'),
          csrf_token_hash: Buffer.from('b'),
          expires_at: new Date(),
        },
        assets: {
          owner_id: user,
          kind: 'GIF',
          title: 'x',
          rights_attested_at: new Date(),
          rights_attestation_version: 'local',
        },
        asset_tags: { asset_id: asset, tag_id: tag },
        asset_states: { asset_id: asset },
        upload_sessions: {
          asset_id: asset,
          owner_id: user,
          idempotency_key: 'abcdefgh',
          quarantine_key: 'private',
          requested_content_type: 'image/gif',
          expires_at: new Date(),
        },
        asset_variants: {
          asset_id: asset,
          rendition_version: 1,
          name: 'DISPLAY_GIF',
          object_key: 'derivative',
          mime_type: 'image/gif',
          size_bytes: 1,
          width: 1,
          height: 1,
          sha256: 'fixture',
        },
        moderation_decisions: {
          asset_id: asset,
          reviewer_id: user,
          action: 'APPROVE',
          reason_code: 'LOCAL',
          prior_state: 'PENDING',
        },
        search_documents: { asset_id: asset, title: 'x', tag_text: '' },
        media_jobs: { asset_id: asset, job_kind: 'PROCESS_GIF' },
        audit_events: {
          actor_user_id: user,
          asset_id: asset,
          event_type: 'TEST',
        },
      };
      const fks =
        await client.query(`SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.connamespace='public'::regnamespace`);
      expect(fks.rowCount).toBe(15);
      for (const fk of fks.rows) {
        const data = { ...rows[fk.table_name], [fk.column_name]: randomUUID() };
        const columns = Object.keys(data);
        await rejectSql(
          `INSERT INTO "${fk.table_name}" (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(data),
          '23503',
        );
      }
      await client.query("INSERT INTO role_grants VALUES($1,'UPLOADER')", [
        user,
      ]);
      await rejectSql('DELETE FROM users WHERE id=$1', [user], '23503');
      await client.query('DELETE FROM assets WHERE id=$1', [asset]);
      await client.query('DELETE FROM users WHERE id=$1', [user]);
      expect(
        (
          await client.query('SELECT * FROM role_grants WHERE user_id=$1', [
            user,
          ])
        ).rowCount,
      ).toBe(0);
    }));

  it('enforces unique email, grants, session tokens, tags, idempotency, keys, variants and job generations', async () =>
    transaction(async () => {
      const { user, asset, tag } = await fixture();
      const second = (await fixture()).asset;
      const inserts: [string, unknown[]][] = [
        [
          "INSERT INTO users(email,password_hash) VALUES('duplicate@local.test','test')",
          [],
        ],
        ["INSERT INTO role_grants VALUES($1,'UPLOADER')", [user]],
        [
          "INSERT INTO sessions(user_id,token_hash,csrf_token_hash,expires_at) VALUES($1,decode('aa','hex'),decode('bb','hex'),now())",
          [user],
        ],
        ["INSERT INTO tags(slug) VALUES('unique-tag')", []],
        ['INSERT INTO asset_tags VALUES($1,$2)', [asset, tag]],
        ['INSERT INTO asset_states(asset_id) VALUES($1)', [asset]],
        [
          "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'abcdefgh','private-key','image/gif',now())",
          [asset, user],
        ],
        [
          "INSERT INTO asset_variants(asset_id,rendition_version,name,object_key,mime_type,size_bytes,width,height,sha256) VALUES($1,1,'DISPLAY_GIF','display-key','image/gif',1,1,1,'test')",
          [asset],
        ],
        [
          "INSERT INTO media_jobs(asset_id,job_kind) VALUES($1,'PROCESS_GIF')",
          [asset],
        ],
        [
          "INSERT INTO search_documents(asset_id,title,tag_text) VALUES($1,'x','')",
          [asset],
        ],
      ];
      for (const [sql, params] of inserts) {
        await client.query(sql, params);
        await rejectSql(sql, params, '23505');
      }
      await rejectSql(
        "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'abcdefgh','other-key','image/gif',now())",
        [second, user],
        '23505',
      );
      await rejectSql(
        "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'different','private-key','image/gif',now())",
        [second, user],
        '23505',
      );
      await rejectSql(
        "INSERT INTO asset_variants(asset_id,rendition_version,name,object_key,mime_type,size_bytes,width,height,sha256) VALUES($1,1,'DISPLAY_GIF','other-key','image/gif',1,1,1,'test')",
        [asset],
        '23505',
      );
      await rejectSql(
        "INSERT INTO asset_variants(asset_id,rendition_version,name,object_key,mime_type,size_bytes,width,height,sha256) VALUES($1,2,'POSTER_PNG','display-key','image/png',1,1,1,'test')",
        [second],
        '23505',
      );
      // Different owner may reuse the same client idempotency key.
      const otherUser = (await fixture()).user;
      await client.query(
        "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'abcdefgh','new-private-key','image/gif',now())",
        [second, otherUser],
      );
    }));

  it('enforces CHECK constraints including all eight state value sets and tag normalization', async () =>
    transaction(async () => {
      const { user, asset } = await fixture();
      await client.query('INSERT INTO asset_states(asset_id) VALUES($1)', [
        asset,
      ]);
      for (const column of [
        'upload_state',
        'processing_state',
        'visibility_state',
        'search_eligibility_state',
        'indexing_state',
        'api_availability_state',
        'delivery_readiness_state',
        'moderation_state',
      ])
        await rejectSql(
          `UPDATE asset_states SET ${column}='INVALID' WHERE asset_id=$1`,
          [asset],
          '23514',
        );
      const cases: [string, unknown[]][] = [
        ["UPDATE users SET status='INVALID' WHERE id=$1", [user]],
        ["INSERT INTO role_grants VALUES($1,'OWNER')", [user]],
        ["UPDATE assets SET kind='VIDEO' WHERE id=$1", [asset]],
        ["UPDATE assets SET title='' WHERE id=$1", [asset]],
        ["UPDATE assets SET title=repeat('x',161) WHERE id=$1", [asset]],
        ['UPDATE assets SET row_version=0 WHERE id=$1', [asset]],
        ...['', 'Upper', ' spaces ', 'x'.repeat(65)].map(
          (slug) =>
            ['INSERT INTO tags(slug) VALUES($1)', [slug]] as [
              string,
              unknown[],
            ],
        ),
        [
          "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'short','x','image/gif',now())",
          [asset, user],
        ],
        [
          "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,repeat('x',129),'x','image/gif',now())",
          [asset, user],
        ],
        [
          "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,expires_at) VALUES($1,$2,'abcdefgh','x','image/png',now())",
          [asset, user],
        ],
        [
          "INSERT INTO upload_sessions(asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,claimed_size_bytes,received_size_bytes,expires_at) VALUES($1,$2,'abcdefgh','x','image/gif',0,-1,now())",
          [asset, user],
        ],
        [
          "INSERT INTO moderation_decisions(asset_id,reviewer_id,action,reason_code,prior_state) VALUES($1,$2,'AUTO_APPROVE','local','PENDING')",
          [asset, user],
        ],
        [
          "INSERT INTO media_jobs(asset_id,job_kind) VALUES($1,'PROCESS_VIDEO')",
          [asset],
        ],
      ];
      for (const [sql, params] of cases) await rejectSql(sql, params, '23514');
      await client.query(
        "INSERT INTO media_jobs(asset_id,job_kind) VALUES($1,'PROCESS_GIF')",
        [asset],
      );
      for (const expression of [
        "status='INVALID'",
        'attempt_count=-1',
        'generation=0',
      ])
        await rejectSql(
          `UPDATE media_jobs SET ${expression} WHERE asset_id=$1`,
          [asset],
          '23514',
        );
      await client.query(
        "INSERT INTO asset_variants(asset_id,rendition_version,name,object_key,mime_type,size_bytes,width,height,sha256) VALUES($1,1,'DISPLAY_GIF','x','image/gif',1,1,1,'test')",
        [asset],
      );
      for (const expression of [
        'rendition_version=0',
        "name='ORIGINAL'",
        'size_bytes=0',
        'width=0',
        'height=0',
      ])
        await rejectSql(
          `UPDATE asset_variants SET ${expression} WHERE asset_id=$1`,
          [asset],
          '23514',
        );
      await client.query("INSERT INTO tags(slug) VALUES('سلام')");
    }));

  it('generates weighted FTS vectors, refreshes on update, matches title/tags/unicode and uses GIN', async () =>
    transaction(async () => {
      const { asset } = await fixture();
      await client.query(
        "INSERT INTO search_documents(asset_id,title,tag_text) VALUES($1,'Dancing Pixels','owned سلام')",
        [asset],
      );
      for (const term of ['dancing', 'OWNED', 'سلام']) {
        const result = await client.query(
          "SELECT search_vector::text AS vector FROM search_documents WHERE search_vector @@ websearch_to_tsquery('simple',$1)",
          [term],
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows[0].vector).toContain("'dancing':1A");
        expect(result.rows[0].vector).toContain("'owned':3B");
      }
      await rejectSql(
        "UPDATE search_documents SET search_vector=to_tsvector('simple','forged') WHERE asset_id=$1",
        [asset],
        '428C9',
      );
      await client.query(
        "UPDATE search_documents SET title='Jumping Pixels',tag_text='fresh' WHERE asset_id=$1",
        [asset],
      );
      expect(
        (
          await client.query(
            "SELECT 1 FROM search_documents WHERE search_vector @@ websearch_to_tsquery('simple','dancing')",
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT 1 FROM search_documents WHERE search_vector @@ websearch_to_tsquery('simple','fresh')",
          )
        ).rowCount,
      ).toBe(1);
      // A tiny fixture normally favors seqscan; prove the GIN index is a usable path.
      await client.query('SET LOCAL enable_seqscan=off');
      const plan = await client.query(
        "EXPLAIN SELECT * FROM search_documents WHERE search_vector @@ websearch_to_tsquery('simple','fresh')",
      );
      expect(JSON.stringify(plan.rows)).toContain('search_docs_fts_idx');
    }));

  it('enforces append-only audit even for the table owner', async () =>
    transaction(async () => {
      const { asset, user } = await fixture();
      await client.query(
        "INSERT INTO audit_events(actor_user_id,asset_id,event_type) VALUES($1,$2,'TEST')",
        [user, asset],
      );
      for (const query of [
        "UPDATE audit_events SET event_type='FORGED'",
        'DELETE FROM audit_events',
        'TRUNCATE audit_events',
      ])
        await rejectSql(query, [], '42501');
      await rejectSql('DELETE FROM assets WHERE id=$1', [asset], '23503');
      expect(
        (await client.query('SELECT count(*) FROM audit_events')).rows[0].count,
      ).toBe('1');
    }));

  it('serializes concurrent migration runners without data loss or extra history rows', async () => {
    const other = await pool.connect();
    try {
      await Promise.all([migrate(client), migrate(other)]);
    } finally {
      other.release();
    }
    expect(
      (await client.query('SELECT count(*) FROM gif_migrations.history'))
        .rows[0].count,
    ).toBe('2');
    expect(
      (await client.query('SELECT count(*) FROM users')).rows[0].count,
    ).toBe('2');
  });
  it('rejects edited or missing applied migration history', async () =>
    temporaryMigrations(async (directory) => {
      const file = new URL('0000_core.sql', directory);
      await writeFile(file, `${await readFile(file, 'utf8')}\n-- edited`);
      await expect(migrate(client, directory)).rejects.toThrow(
        'Migration history mismatch',
      );
      await writeFile(
        new URL('meta/_journal.json', directory),
        JSON.stringify({ entries: [] }),
      );
      await expect(migrate(client, directory)).rejects.toThrow(
        'Migration history mismatch',
      );
    }));
  it('rolls back failed DDL and migration ledger together', async () =>
    temporaryMigrations(async (directory) => {
      const journalFile = new URL('meta/_journal.json', directory);
      const journal = JSON.parse(await readFile(journalFile, 'utf8'));
      journal.entries.push({ idx: 2, tag: '0002_failure' });
      await writeFile(journalFile, JSON.stringify(journal));
      await writeFile(
        new URL('0002_failure.sql', directory),
        'CREATE TABLE should_rollback(id integer); SELECT deliberately_missing_function();',
      );
      await expect(migrate(client, directory)).rejects.toMatchObject({
        code: '42883',
      });
      expect(
        (await client.query("SELECT to_regclass('should_rollback') AS name"))
          .rows[0].name,
      ).toBeNull();
      expect(
        (await client.query('SELECT count(*) FROM gif_migrations.history'))
          .rows[0].count,
      ).toBe('2');
    }));

  it('refuses production seed, inspect and reset before connecting and logs no credentials', async () => {
    for (const command of ['seed', 'inspect', 'reset']) {
      const result = spawnSync(
        process.execPath,
        ['packages/db/dist/cli.js', command, `--confirm=${database}`],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...devEnv,
            NODE_ENV: 'production',
            DATABASE_URL:
              'postgresql://sensitive_password@localhost:1/gif_platform_test',
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Database command failed');
      expect(result.stderr + result.stdout).not.toContain('sensitive_password');
    }
    const output = execFileSync(
      process.execPath,
      ['packages/db/dist/cli.js', 'seed'],
      { encoding: 'utf8', env: { ...process.env, ...devEnv } },
    );
    expect(output.trim()).toBe('Database seed completed');
  });
  it('requires exact reset confirmation, rolls back all core schema, then migrates and seeds again', async () => {
    await expect(resetDevelopment(client, devEnv, undefined)).rejects.toThrow(
      'confirmation',
    );
    expect(
      (await client.query('SELECT count(*) FROM users')).rows[0].count,
    ).toBe('2');
    await resetDevelopment(client, devEnv, `--confirm=${database}`);
    expect(
      (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        )
      ).rowCount,
    ).toBe(0);
    await migrate(client);
    await seedDevelopment(client, devEnv);
    await migrate(client);
    await seedDevelopment(client, devEnv);
    expect((await inspectDevelopment(client, devEnv)).assetCount).toBe(0);
  });
});
