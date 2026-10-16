import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';

export const migrationDirectory = new URL('../migrations/', import.meta.url);

/** Apply Drizzle-generated SQL under one transaction and a database-wide lock.
 * A checksum ledger rejects edited history instead of silently ignoring drift. */
export async function migrate(
  client: PoolClient,
  directory: URL = migrationDirectory,
): Promise<void> {
  const journal = JSON.parse(
    await readFile(new URL('meta/_journal.json', directory), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };
  const migrations = await Promise.all(
    journal.entries.map(async (entry, index) => {
      if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag))
        throw new Error('Invalid migration journal');
      const source = await readFile(
        new URL(`${entry.tag}.sql`, directory),
        'utf8',
      );
      return {
        name: entry.tag,
        source,
        hash: createHash('sha256').update(source).digest('hex'),
      };
    }),
  );
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71401, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS gif_migrations');
    await client.query(`CREATE TABLE IF NOT EXISTS gif_migrations.history (
      position integer PRIMARY KEY, name text NOT NULL UNIQUE, hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = await client.query<{
      position: number;
      name: string;
      hash: string;
    }>(
      'SELECT position, name, hash FROM gif_migrations.history ORDER BY position',
    );
    for (const [index, row] of applied.rows.entries()) {
      const expected = migrations[index];
      if (
        row.position !== index ||
        !expected ||
        row.name !== expected.name ||
        row.hash !== expected.hash
      )
        throw new Error('Migration history mismatch');
    }
    for (const [index, migration] of migrations.entries()) {
      if (index < applied.rows.length) continue;
      await client.query(migration.source);
      await client.query(
        'INSERT INTO gif_migrations.history(position,name,hash) VALUES ($1,$2,$3)',
        [index, migration.name, migration.hash],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
