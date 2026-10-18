// One-shot operator process, never an HTTP endpoint or application startup hook.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createResilientPool } from '../packages/db/dist/pool.js';
import { migrate, migrationDirectory } from '../packages/db/dist/migrate.js';
import {
  assertStaging,
  bootstrapStagingIdentities,
  provisionStagingRoles,
} from '../packages/db/dist/staging.js';
import { readApiConfig } from '../packages/config/dist/index.js';
import {
  checkUploadStorage,
  provisionPrivateStorage,
} from '../packages/storage/dist/index.js';

try {
  assertStaging(process.env);
  const command = process.argv[2];
  if (
    ![
      'migrate',
      'provision',
      'bootstrap',
      'verify',
      'inventory',
      'inventory-empty',
    ].includes(command)
  )
    throw new Error('Unknown staging command');
  const pool = createResilientPool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      if (command === 'migrate') await migrate(client);
      if (command === 'provision') {
        await provisionStagingRoles(client, process.env);
        await provisionPrivateStorage(readApiConfig(process.env));
      }
      if (command === 'bootstrap')
        await bootstrapStagingIdentities(client, process.env);
      if (command === 'verify') {
        const journal = JSON.parse(
          await readFile(
            new URL('meta/_journal.json', migrationDirectory),
            'utf8',
          ),
        );
        const rows = (
          await client.query(
            'SELECT position,name,hash FROM gif_migrations.history ORDER BY position',
          )
        ).rows;
        if (rows.length !== journal.entries.length)
          throw new Error('Migration mismatch');
        for (const [index, entry] of journal.entries.entries()) {
          const source = await readFile(
            new URL(`${entry.tag}.sql`, migrationDirectory),
          );
          if (
            rows[index].position !== index ||
            rows[index].name !== entry.tag ||
            rows[index].hash !==
              createHash('sha256').update(source).digest('hex')
          )
            throw new Error('Migration mismatch');
        }
        await checkUploadStorage(readApiConfig(process.env));
      }
      if (command === 'inventory' || command === 'inventory-empty') {
        const counts = {};
        for (const table of [
          'users',
          'assets',
          'asset_variants',
          'media_jobs',
          'moderation_decisions',
          'audit_events',
        ])
          counts[table] = Number(
            (await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
          );
        if (
          command === 'inventory-empty' &&
          Object.values(counts).some((count) => count !== 0)
        )
          throw new Error('Expected empty platform');
        console.log(JSON.stringify({ event: 'staging_inventory', counts }));
      }
      console.log(
        JSON.stringify({ event: 'staging_admin', command, status: 'passed' }),
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
} catch {
  console.error(
    'Staging command failed; deployment must stop. Credentials and raw errors suppressed.',
  );
  process.exitCode = 1;
}
