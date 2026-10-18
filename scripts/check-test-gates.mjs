import { readdir, readFile } from 'node:fs/promises';
const found = [];
for (const root of ['apps', 'packages', 'tests']) {
  for (const file of await readdir(root, { recursive: true })) {
    if (
      /(?:^|\/)(?:node_modules|dist|\.next)\//.test(file) ||
      !/\.(?:test|spec)\.ts$/.test(file)
    )
      continue;
    if (
      /\b(?:it|test|describe)\.(?:skip|todo|only|skipIf|runIf)\b/.test(
        await readFile(`${root}/${file}`, 'utf8'),
      )
    )
      found.push(`${root}/${file}`);
  }
}
if (found.length)
  throw new Error(
    `Required regression gates may not be disabled: ${found.join(', ')}`,
  );
console.log(
  'PASS: regression sources contain no skip/todo/only or conditional gate declarations',
);

for (const file of await readdir('tests/staging')) {
  const source = await readFile(`tests/staging/${file}`, 'utf8');
  if (/\.route\(|route\.fulfill|vi\.mock|test\.fixme/.test(source))
    throw new Error('Real staging flow cannot mock network or skip');
}
console.log(
  'PASS: real staging sources contain no network mocks or fixme gates',
);
