import { execFileSync } from 'node:child_process';
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
if (!response.ok) throw new Error('Log hygiene login failed');
const body = await response.json();
const cookie = response.headers.get('set-cookie')?.split(';')[0];
if (!cookie || !body.csrfToken) throw new Error('Log hygiene session missing');
const logout = await fetch(`${origin}/api/v1/auth/logout`, {
  method: 'POST',
  headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': body.csrfToken },
});
if (logout.status !== 204) throw new Error('Log hygiene logout failed');
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
for (const value of [
  cookie.split('=')[1],
  body.csrfToken,
  process.env.DEV_UPLOADER_PASSWORD,
  process.env.DEV_REVIEWER_PASSWORD,
  process.env.POSTGRES_PASSWORD,
  process.env.S3_SECRET_ACCESS_KEY,
])
  if (!value || logs.includes(value))
    throw new Error('Sensitive runtime log value detected or fixture missing');
console.log(
  'B02 runtime logs contain no tested passwords, session token or CSRF token',
);
