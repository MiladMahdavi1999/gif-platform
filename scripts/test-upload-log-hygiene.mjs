import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { animatedGif } from '../packages/testing/dist/index.js';
process.loadEnvFile('.env');
const args = ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml'];
const running = execFileSync(
  'docker',
  [...args, 'ps', '--status', 'running', '--services'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
if (
  !['api', 'web', 'worker', 'db', 'minio', 'edge'].every((s) =>
    running.includes(s),
  )
)
  throw new Error('All six services must be live for upload log verification');
const origin = process.env.PUBLIC_BASE_URL;
const login = await fetch(`${origin}/api/v1/auth/login`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.DEV_UPLOADER_EMAIL,
    password: process.env.DEV_UPLOADER_PASSWORD,
  }),
});
if (!login.ok) throw new Error('Upload log verification sign-in failed');
const session = await login.json();
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie || !session.csrfToken)
  throw new Error('Upload log verification session missing');
const headers = {
  Origin: origin,
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrfToken,
};
const response = await fetch(`${origin}/api/v1/uploads`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': randomUUID() },
  body: JSON.stringify({
    kind: 'GIF',
    title: 'Original log verification fixture',
    tags: ['original'],
    rightsAttested: true,
    rightsAttestationVersion: 'v1',
    claimedSizeBytes: animatedGif().length,
  }),
});
if (response.status !== 201)
  throw new Error('Upload log verification intent failed');
const intent = await response.json();
const data = new FormData();
for (const [key, value] of Object.entries(intent.form.fields))
  data.append(key, value);
data.append(
  'file',
  new Blob([animatedGif()], { type: 'image/gif' }),
  'original.gif',
);
const posted = await fetch(intent.form.url, { method: 'POST', body: data });
if (posted.status !== 204)
  throw new Error('Upload log verification signed POST failed');
const receipt = await fetch(
  `${origin}/api/v1/uploads/${intent.uploadId}/complete`,
  { method: 'POST', headers, body: '{}' },
);
if (receipt.status !== 202)
  throw new Error('Upload log verification receipt failed');
const logout = await fetch(`${origin}/api/v1/auth/logout`, {
  method: 'POST',
  headers,
  body: '{}',
});
if (logout.status !== 204)
  throw new Error('Upload log verification logout failed');
const logs = execFileSync('docker', [...args, 'logs', '--no-color'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
if (!logs.trim()) throw new Error('Runtime logs missing');
for (const value of [
  cookie.split('=')[1],
  session.csrfToken,
  intent.form.fields.Policy,
  intent.form.fields['X-Amz-Signature'],
  process.env.S3_SECRET_ACCESS_KEY,
  process.env.DEV_UPLOADER_PASSWORD,
])
  if (!value || logs.includes(value))
    throw new Error(
      'Sensitive upload runtime value detected or fixture missing',
    );
console.log(
  'PASS: actual signed upload/completion logs exclude session, CSRF, policy, signature and passwords',
);
