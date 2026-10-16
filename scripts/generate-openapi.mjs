import { format } from 'prettier';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createOpenApiDocument } from '../packages/contracts/dist/index.js';
const path = new URL('../docs/api/openapi.json', import.meta.url);
const value = await format(JSON.stringify(createOpenApiDocument()), {
  parser: 'json',
});
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== value)
    throw new Error('OpenAPI drift: run pnpm api:generate');
  console.log('OpenAPI matches implemented contracts');
} else {
  await mkdir(new URL('../docs/api/', import.meta.url), { recursive: true });
  await writeFile(path, value);
}
