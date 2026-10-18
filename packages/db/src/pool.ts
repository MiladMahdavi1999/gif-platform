import pg from 'pg';

/** A disconnect can arrive between transaction queries while a client is checked out.
 * Pool-level handlers cover idle clients only. Keep a client-level handler too;
 * pending/future queries still reject and pg removes broken clients on release.
 * Never serialize database errors: they can contain connection/private values.
 */
export function createResilientPool(options: pg.PoolConfig) {
  const pool = new pg.Pool(options);
  pool.on('error', () => {});
  pool.on('connect', (client) => {
    client.on('error', () => {});
  });
  return pool;
}
