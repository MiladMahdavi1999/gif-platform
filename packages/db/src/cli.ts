import { createResilientPool } from './pool.js';
import { migrate } from './migrate.js';
import {
  assertDevelopmentDatabase,
  inspectDevelopment,
  seedDevelopment,
} from './dev.js';
import { resetDevelopment } from './reset.js';
import { provisionDevelopmentWorker } from './worker-access.js';

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'seed', 'reset', 'inspect'].includes(command ?? ''))
    throw new Error('Unknown database command');
  // Refuse unsafe modes before creating a connection, including missing NODE_ENV.
  if (command !== 'migrate') assertDevelopmentDatabase(process.env);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = createResilientPool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await pool.connect();
    try {
      if (command === 'migrate') await migrate(client);
      if (command === 'seed') {
        await seedDevelopment(client, process.env);
        if (process.env.WORKER_DATABASE_URL)
          await provisionDevelopmentWorker(process.env);
      }
      if (command === 'reset')
        await resetDevelopment(client, process.env, process.argv[3]);
      if (command === 'inspect')
        console.log(
          JSON.stringify(await inspectDevelopment(client, process.env)),
        );
      else console.log(`Database ${command} completed`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    'Database command failed. Check mode, local target, confirmation and configuration; credentials are never printed.',
  );
  process.exitCode = 1;
});
