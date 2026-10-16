import assert from 'node:assert/strict';
await import('./test-upload-log-hygiene.mjs');
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env');
const origin = process.env.PUBLIC_BASE_URL;
const response = await fetch(`${origin}/api/v1/auth/login`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.DEV_REVIEWER_EMAIL,
    password: process.env.DEV_REVIEWER_PASSWORD,
  }),
});
if (!response.ok) throw new Error('Review log verification sign-in failed');
const session = await response.json();
const cookie = response.headers.get('set-cookie')?.split(';')[0];
if (!cookie || !session.csrfToken)
  throw new Error('Review log verification session missing');
const headers = {
  Origin: origin,
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrfToken,
};
// The preceding upload/processing log check creates a real pending owned fixture.
const queue = await fetch(`${origin}/api/v1/review/queue`, { headers });
if (!queue.ok) throw new Error('Review log verification queue failed');
const asset = (await queue.json()).items[0];
if (!asset)
  throw new Error(
    'Real processed fixture required for review log verification',
  );
const note = `private-review-note-${randomUUID()}`;
const decision = {
  decision: 'APPROVE',
  reasonCode: 'POLICY_PASSED',
  reasonNote: note,
  expectedVersion: asset.rowVersion,
};
const url = `${origin}/api/v1/review/assets/${asset.assetId}`;
for (let i = 0; i < 2; i++) {
  const result = await fetch(`${url}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify(decision),
  });
  if (!result.ok)
    throw new Error('Review log verification approval/replay failed');
}
const querySentinel = `private-query-${randomUUID()}`;
const searched = await fetch(`${origin}/api/v1/public/gifs?q=${querySentinel}`);
assert.equal(searched.status, 200);
const publicList = await fetch(`${origin}/api/v1/public/gifs`);
assert.equal(publicList.status, 200);
assert.ok(
  (await publicList.json()).items.some((item) => item.id === asset.assetId),
);
const publicDetail = await fetch(
  `${origin}/api/v1/public/gifs/${asset.assetId}`,
);
assert.equal(publicDetail.status, 200);
const publicBody = await publicDetail.text();
assert.doesNotMatch(
  publicBody,
  /objectKey|objectVersion|quarantine|X-Amz|@local\.test/,
);
for (const variant of ['display.gif', 'poster.png']) {
  const media = await fetch(`${origin}/media/${asset.assetId}/${variant}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(
    media.headers.get('cross-origin-resource-policy'),
    'same-origin',
  );
  assert.equal(
    media.headers.get('cache-control'),
    'public, max-age=30, must-revalidate',
  );
  assert.ok((await media.arrayBuffer()).byteLength > 0);
}
assert.equal(
  (await fetch(`${origin}/media/${asset.assetId}/ORIGINAL`)).status,
  404,
);
const removal = await fetch(`${url}/remove`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    reasonCode: 'RIGHTS_REQUEST',
    reasonNote: note,
    expectedVersion: asset.rowVersion + 1,
  }),
});
if (!removal.ok) throw new Error('Public log verification removal failed');
for (const path of [
  `/api/v1/public/gifs/${asset.assetId}`,
  `/media/${asset.assetId}/display.gif`,
  `/media/${asset.assetId}/poster.png`,
]) {
  const denied = await fetch(`${origin}${path}`, {
    headers: { 'If-None-Match': '*', Range: 'bytes=0-10' },
  });
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
}

const detail = await fetch(url, { headers });
if (!detail.ok) throw new Error('Review log verification history failed');
const history = await detail.json();
if (
  history.states.moderation !== 'REMOVED' ||
  history.decisions.length !== 2 ||
  history.audit.filter((e) => e.eventType.startsWith('MODERATION_')).length !==
    2
)
  throw new Error('Review log verification audit mismatch');
const logout = await fetch(`${origin}/api/v1/auth/logout`, {
  method: 'POST',
  headers,
  body: '{}',
});
if (logout.status !== 204)
  throw new Error('Review log verification logout failed');
const logs = execFileSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/compose.yaml',
    'logs',
    '--no-color',
  ],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);
if (!logs.trim()) throw new Error('Runtime logs missing');
for (const value of [
  cookie.split('=')[1],
  session.csrfToken,
  note,
  querySentinel,
  process.env.PUBLIC_CURSOR_SECRET,
  process.env.DEV_REVIEWER_PASSWORD,
  process.env.S3_SECRET_ACCESS_KEY,
  process.env.DATABASE_URL,
])
  if (!value || logs.includes(value))
    throw new Error(
      'Sensitive reviewer runtime value detected or fixture missing',
    );
console.log(
  'PASS B06: actual approved public search/detail/sanitized media, immediate conditional/range takedown denials, retained audit; logs exclude search query, cursor key, sessions, CSRF, notes and credentials',
);
