import pg from 'pg';

export * as schema from './schema.js';
export { drizzle } from 'drizzle-orm/node-postgres';
export function createDatabaseProbe(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 1500,
    idleTimeoutMillis: 1000,
  });
  // A dependency restart can close idle clients. Do not crash or log connection details.
  pool.on('error', () => {});
  return {
    async check(): Promise<void> {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query('SELECT 1');
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        client.release(failed);
      }
    },
    close: () => pool.end(),
  };
}
export * from './auth.js';
export * from './uploads.js';
export * from './processing.js';
export * from './worker-access.js';
export * from './review.js';
export * from './public.js';
