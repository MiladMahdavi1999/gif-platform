import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env');
const args = ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml'];
const operator = (...command) =>
  JSON.parse(
    execFileSync(
      'docker',
      [
        ...args,
        'exec',
        '-T',
        '-e',
        'ALLOW_INTERNAL_OPERATIONS=true',
        'api',
        'node',
        'scripts/operations.mjs',
        ...command,
      ],
      { encoding: 'utf8' },
    ),
  );
const report = operator('inspect');
assert.equal(report.readOnly, true);
assert.ok(report.operationId);
assert.ok(report.jobs.length <= 100 && report.degradedMedia.length <= 100);
assert.doesNotMatch(
  JSON.stringify(report),
  /lease_token|objectKey|objectVersion|quarantine\/|reasonNote|@local\.test/,
);
const orphan = operator('orphans', randomUUID());
assert.equal(orphan.mode, 'DETECTION_ONLY');
assert.equal(orphan.deletionPermitted, false);
assert.equal(orphan.objects.length, 0);
for (const command of [
  ['inspect', '--delete'],
  ['orphans', '../'],
  ['orphans', randomUUID(), '--delete'],
]) {
  const denied = spawnSync(
    'docker',
    [
      ...args,
      'exec',
      '-T',
      '-e',
      'ALLOW_INTERNAL_OPERATIONS=true',
      'api',
      'node',
      'scripts/operations.mjs',
      ...command,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /OPERATIONS_UNAVAILABLE_OR_INVALID_INPUT/);
}
const disabled = spawnSync(
  'docker',
  [...args, 'exec', '-T', 'api', 'node', 'scripts/operations.mjs', 'inspect'],
  { encoding: 'utf8' },
);
assert.notEqual(disabled.status, 0);
const sentinel = `private-operational-sentinel-${randomUUID()}`;
const response = await fetch(
  `${process.env.PUBLIC_BASE_URL}/api/v1/private-${sentinel}?signed=${sentinel}`,
  {
    headers: {
      Cookie: `gif_session=${sentinel}`,
      'X-CSRF-Token': sentinel,
      'X-Request-ID': sentinel,
    },
  },
);
assert.equal(response.status, 404);
assert.ok(!(await response.text()).includes(sentinel));
const requestId = response.headers.get('x-request-id');
assert.match(requestId, /^[a-f0-9-]{36}$/);
for (const path of [
  '/api/v1/internal/operations',
  '/api/v1/operations',
  '/api/v1/ops',
])
  assert.equal(
    (await fetch(`${process.env.PUBLIC_BASE_URL}${path}`)).status,
    404,
  );
// Exercise an actual PostgreSQL constraint error: default DETAIL logging would
// reveal its rejected value even though the application never logs raw errors.
const databaseSentinel = `PRIVATE-DATABASE-SENTINEL-${randomUUID()}`;
const rejected = spawnSync(
  'docker',
  [
    ...args,
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    process.env.POSTGRES_USER,
    '-d',
    process.env.POSTGRES_DB,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO tags(slug) VALUES('${databaseSentinel}')`,
  ],
  { encoding: 'utf8' },
);
assert.notEqual(rejected.status, 0);
assert.match(rejected.stderr, /check constraint/);
const logs = execFileSync('docker', [...args, 'logs', '--no-color'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
assert.ok(logs.includes(requestId));
assert.ok(logs.includes('request_completed'));
assert.ok(!logs.includes(sentinel));
assert.ok(!logs.includes(databaseSentinel));
assert.doesNotMatch(
  logs,
  /gif-job-|\/tmp\/.*input\.gif|quarantine\/|X-Amz-Signature/,
);
console.log(
  'PASS B08: bounded private diagnostics, detection-only orphan scope, denied destructive/anonymous access, safe correlated runtime logs',
);
