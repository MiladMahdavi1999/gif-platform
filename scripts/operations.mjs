import { randomUUID } from 'node:crypto';
import { createOperationsRepository } from '../packages/db/dist/index.js';
import { detectOrphans } from '../packages/storage/dist/index.js';
import { readApiConfig } from '../packages/config/dist/index.js';

const operationId = randomUUID();
try {
  const [command, assetId, ...extra] = process.argv.slice(2);
  if (
    process.env.ALLOW_INTERNAL_OPERATIONS !== 'true' ||
    extra.length ||
    !['inspect', 'orphans'].includes(command) ||
    (command === 'inspect' && assetId) ||
    (command === 'orphans' && !assetId)
  )
    throw new Error('Refused');
  const config = readApiConfig(process.env);
  const repository = createOperationsRepository(config.DATABASE_URL);
  try {
    const result =
      command === 'inspect'
        ? await repository.inspect()
        : await detectOrphans(
            config,
            assetId,
            await repository.references(assetId),
          );
    console.log(JSON.stringify({ operationId, command, ...result }));
  } finally {
    await repository.close();
  }
} catch {
  console.error(
    JSON.stringify({
      operationId,
      status: 'FAILED',
      code: 'OPERATIONS_UNAVAILABLE_OR_INVALID_INPUT',
    }),
  );
  process.exitCode = 1;
}
