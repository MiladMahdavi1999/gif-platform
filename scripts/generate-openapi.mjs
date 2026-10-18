import { format } from 'prettier';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createOpenApiDocument } from '../packages/contracts/dist/index.js';
const paths = ['../docs/api/openapi.json', '../docs/api/v1/openapi.json'].map(
  (path) => new URL(path, import.meta.url),
);
const value = await format(JSON.stringify(createOpenApiDocument()), {
  parser: 'json',
});
if (process.argv.includes('--check')) {
  for (const path of paths)
    if ((await readFile(path, 'utf8')) !== value)
      throw new Error('OpenAPI drift: run pnpm api:generate');
  console.log('OpenAPI matches implemented contracts');
} else {
  await mkdir(new URL('../docs/api/v1/', import.meta.url), { recursive: true });
  for (const path of paths) await writeFile(path, value);
}
