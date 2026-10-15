import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { verifyDevelopmentTarget } from './dev.js';

/** Explicit, local-only rollback. Production migrations are forward-only. */
export async function resetDevelopment(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
  confirmation: string | undefined,
): Promise<void> {
  const database = await verifyDevelopmentTarget(client, env);
  if (confirmation !== `--confirm=${database}`)
    throw new Error('Reset requires an exact database confirmation');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71401, 1)');
    await client.query(
      await readFile(new URL('../rollback/core.sql', import.meta.url), 'utf8'),
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
