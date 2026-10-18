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
import {
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { readApiConfig } from '../packages/config/dist/index.js';
import {
  checkUploadStorage,
  provisionPrivateStorage,
  s3Client,
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
      'verify-pins',
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
      if (command === 'verify-pins') {
        const config = readApiConfig(process.env),
          storage = s3Client(config);
        try {
          const sources = (
            await client.query(
              'SELECT quarantine_key AS key,received_version_id AS version,received_etag AS etag,received_size_bytes AS size FROM upload_sessions WHERE completed_at IS NOT NULL',
            )
          ).rows;
          const derivatives = (
            await client.query(
              'SELECT object_key AS key,object_version_id AS version,sha256,size_bytes AS size FROM asset_variants',
            )
          ).rows;
          if (sources.length > 100 || derivatives.length > 100)
            throw new Error('Disposable verification bound exceeded');
          for (const source of sources) {
            const head = await storage.send(
              new HeadObjectCommand({
                Bucket: config.S3_QUARANTINE_BUCKET,
                Key: source.key,
                VersionId: source.version,
              }),
            );
            if (
              head.VersionId !== source.version ||
              head.ETag !== source.etag ||
              head.ContentLength !== Number(source.size)
            )
              throw new Error('Source version mismatch');
          }
          for (const derivative of derivatives) {
            const media = await storage.send(
              new GetObjectCommand({
                Bucket: config.S3_DERIVATIVES_BUCKET,
                Key: derivative.key,
                VersionId: derivative.version,
              }),
            );
            const bytes = await media.Body.transformToByteArray();
            if (
              media.VersionId !== derivative.version ||
              bytes.length !== Number(derivative.size) ||
              createHash('sha256').update(bytes).digest('hex') !==
                derivative.sha256
            )
              throw new Error('Derivative version mismatch');
          }
          const inventory = [];
          for (const Bucket of [
            config.S3_QUARANTINE_BUCKET,
            config.S3_DERIVATIVES_BUCKET,
          ]) {
            const versions = await storage.send(
              new ListObjectVersionsCommand({ Bucket, MaxKeys: 100 }),
            );
            if (versions.IsTruncated)
              throw new Error('Disposable inventory bound exceeded');
            for (const value of versions.Versions ?? [])
              inventory.push([
                Bucket,
                value.Key,
                value.VersionId,
                value.IsLatest,
                value.ETag,
                value.Size,
              ]);
            for (const value of versions.DeleteMarkers ?? [])
              inventory.push([
                Bucket,
                value.Key,
                value.VersionId,
                value.IsLatest,
                'delete-marker',
              ]);
          }
          inventory.sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          );
          console.log(
            JSON.stringify({
              event: 'staging_version_inventory',
              sourcePins: sources.length,
              derivativePins: derivatives.length,
              objectVersions: inventory.length,
              inventorySha256: createHash('sha256')
                .update(JSON.stringify(inventory))
                .digest('hex'),
            }),
          );
        } finally {
          storage.destroy();
        }
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
