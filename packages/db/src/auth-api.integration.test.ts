import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createAuthRepository } from '@gif/db';
import { migrate } from './migrate.js';
import { assertDevelopmentDatabase, seedDevelopment } from './dev.js';
import { createApp } from '../../../apps/api/src/app.js';
import { csrfFor, digest, LoginLimiter } from '../../../apps/api/src/auth.js';

if (
  process.env.NODE_ENV === 'production' ||
  process.env.APP_ENV === 'production' ||
  process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true'
)
  throw new Error('Explicit local integration test opt-in is required');
const source = new URL(process.env.TEST_DATABASE_URL ?? '');
assertDevelopmentDatabase({
  NODE_ENV: 'development',
  APP_ENV: 'development',
  ALLOW_DEV_DATABASE_COMMANDS: 'true',
  DATABASE_URL: source.href,
});
if (!source.pathname.endsWith('_test'))
  throw new Error('Integration database must end in _test');
const name = `gif_platform_b02_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const admin = new pg.Pool({ connectionString: source.href });
const pool = new pg.Pool({ connectionString: target.href });
const auth = createAuthRepository(target.href);
const origin = 'https://gif.test';
const password = randomBytes(24).toString('base64url');
const headers = {
  origin,
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
};
const options = {
  repository: auth.repository,
  origin,
  cookieName: 'gif_session',
  ttlSeconds: 86400,
  secure: true,
  limiter: new LoginLimiter(100, 200),
};
const app = createApp(
  { database: async () => {}, storage: async () => {} },
  false,
  options,
);
let created = false;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const client = await pool.connect();
  try {
    await migrate(client);
    await seedDevelopment(client, {
      NODE_ENV: 'development',
      APP_ENV: 'development',
      ALLOW_DEV_DATABASE_COMMANDS: 'true',
      DATABASE_URL: target.href,
      DEV_UPLOADER_EMAIL: 'uploader@local.test',
      DEV_UPLOADER_PASSWORD: password,
      DEV_REVIEWER_EMAIL: 'reviewer@local.test',
      DEV_REVIEWER_PASSWORD: password,
    });
  } finally {
    client.release();
  }
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await auth.close();
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
});
async function login(email = 'reviewer@local.test', cookie?: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const sessionCookie = response.cookies[0]!;
  return {
    response,
    cookie: `${sessionCookie.name}=${sessionCookie.value}`,
    token: sessionCookie.value,
    csrf: response.json().csrfToken as string,
  };
}
function session(cookie: string) {
  return app.inject({ url: '/api/v1/auth/session', headers: { cookie } });
}

describe('real PostgreSQL session authentication', () => {
  it('uses B01 Argon2id accounts, stores only hashes, persists and revokes on logout', async () => {
    const result = await login();
    const stored = (
      await pool.query(
        'SELECT token_hash,csrf_token_hash FROM sessions WHERE token_hash=$1',
        [digest(result.token)],
      )
    ).rows[0];
    expect(stored.token_hash.equals(digest(result.token))).toBe(true);
    expect(stored.csrf_token_hash.equals(digest(result.csrf))).toBe(true);
    const restored = (await session(result.cookie)).json();
    expect(restored.authenticated).toBe(true);
    expect(restored.csrfToken === result.csrf).toBe(true);
    expect(restored.user.roles).toEqual(['REVIEWER']);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin, cookie: result.cookie, 'x-csrf-token': result.csrf },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies[0]?.maxAge).toBe(0);
    expect((await session(result.cookie)).json()).toEqual({
      authenticated: false,
    });
    expect(
      (
        await pool.query(
          'SELECT revoked_at FROM sessions WHERE token_hash=$1',
          [digest(result.token)],
        )
      ).rows[0].revoked_at,
    ).toBeInstanceOf(Date);
  });
  it('enforces anonymous 401, uploader 403 and reviewer 200; ADMIN has no implicit reviewer delegation', async () => {
    expect((await app.inject('/api/v1/review')).statusCode).toBe(401);
    const uploader = await login('uploader@local.test');
    const reviewer = await login();
    expect(
      (
        await app.inject({
          url: '/api/v1/review',
          headers: { cookie: uploader.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/v1/review',
          headers: { cookie: reviewer.cookie },
        })
      ).statusCode,
    ).toBe(200);
    await pool.query(
      "UPDATE role_grants SET role='ADMIN' WHERE user_id=(SELECT id FROM users WHERE email='reviewer@local.test')",
    );
    expect(
      (
        await app.inject({
          url: '/api/v1/review',
          headers: { cookie: reviewer.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await pool.query(
      "UPDATE role_grants SET role='REVIEWER' WHERE role='ADMIN'",
    );
  });
  it('rotates login sessions and rejects expired, revoked, nonexistent, malformed and duplicate cookies', async () => {
    const first = await login();
    const second = await login('reviewer@local.test', first.cookie);
    expect(first.token !== second.token).toBe(true);
    expect((await session(first.cookie)).json()).toEqual({
      authenticated: false,
    });
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [digest(second.token)],
    );
    const arbitrary = randomBytes(32).toString('base64url');
    for (const cookie of [
      second.cookie,
      `gif_session=${arbitrary}`,
      'gif_session=bad',
      `${second.cookie}; ${second.cookie}`,
    ])
      expect((await session(cookie)).json()).toEqual({ authenticated: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { origin, cookie: first.cookie, 'x-csrf-token': first.csrf },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rejects absent, forged and cross-session CSRF without revoking the session', async () => {
    const a = await login();
    const b = await login();
    for (const csrf of [undefined, 'invalid', b.csrf]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          origin,
          cookie: a.cookie,
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('CSRF_REJECTED');
    }
    expect((await session(a.cookie)).json().authenticated).toBe(true);
  });
  it('rejects missing/null/forged Origin, cross-site Fetch Metadata, form content, malformed JSON and unknown fields', async () => {
    for (const bad of [
      {},
      { origin: 'null' },
      { origin: 'https://evil.test' },
      { origin, 'sec-fetch-site': 'cross-site' },
      { origin, 'sec-fetch-site': 'same-site' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json', ...bad },
        payload: { email: 'reviewer@local.test', password },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin, 'content-type': 'text/plain' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers,
          payload: '{',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers,
          payload: { email: 'reviewer@local.test', password, role: 'ADMIN' },
        })
      ).statusCode,
    ).toBe(400);
    const logged = await login();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: {
            cookie: logged.cookie,
            'x-csrf-token': logged.csrf,
            origin: 'https://evil.test',
          },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('returns uniform wrong-password, unknown-account and disabled-account errors', async () => {
    const errors = [];
    for (const email of [
      'uploader@local.test',
      'missing@local.test',
      'reviewer@local.test',
    ]) {
      if (email.startsWith('reviewer'))
        await pool.query("UPDATE users SET status='DISABLED' WHERE email=$1", [
          email,
        ]);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: {
          email,
          password: email.startsWith('reviewer') ? password : 'incorrect',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.cookies).toHaveLength(0);
      const { code, message } = response.json().error;
      errors.push({ code, message });
    }
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[1]).toEqual(errors[2]);
    await pool.query("UPDATE users SET status='ACTIVE'");
  });
  it('invalidates sessions when an account is disabled and normalizes email', async () => {
    const logged = await login('  UPLOADER@LOCAL.TEST  ');
    await pool.query(
      "UPDATE users SET status='DISABLED' WHERE email='uploader@local.test'",
    );
    expect((await session(logged.cookie)).json()).toEqual({
      authenticated: false,
    });
    await pool.query("UPDATE users SET status='ACTIVE'");
  });
  it('sets host-only secure HttpOnly Lax cookies, expiry and no-store; local HTTP omits Secure only in development', async () => {
    const local = createApp(
      { database: async () => {}, storage: async () => {} },
      false,
      { ...options, secure: false },
    );
    try {
      const result = await login();
      const cookie = result.response.cookies[0]!;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
      expect(cookie.path).toBe('/');
      expect(cookie.domain).toBeUndefined();
      expect(cookie.maxAge).toBe(86400);
      expect(cookie.expires).toBeInstanceOf(Date);
      expect(result.response.headers['cache-control']).toBe('no-store');
      expect(
        result.response.headers['access-control-allow-origin'],
      ).toBeUndefined();
      const response = await local.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: { email: 'uploader@local.test', password },
      });
      expect(response.cookies[0]?.secure).toBeUndefined();
      expect(response.cookies[0]?.httpOnly).toBe(true);
    } finally {
      await local.close();
    }
  });
  it('rate limits before verification, rejects spoofed forwarded IPs, supplies Retry-After', async () => {
    const limited = createApp(
      { database: async () => {}, storage: async () => {} },
      false,
      { ...options, limiter: new LoginLimiter(2, 3) },
    );
    try {
      for (let index = 0; index < 3; index++) {
        const response = await limited.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { ...headers, 'x-forwarded-for': `198.51.100.${index}` },
          payload: { email: 'missing@local.test', password: 'incorrect' },
        });
        expect(response.statusCode).toBe(index === 2 ? 429 : 401);
        if (index === 2)
          expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      }
    } finally {
      await limited.close();
    }
  });
  it('sanitizes repository failures and never accepts a session with mismatched CSRF storage', async () => {
    const token = randomBytes(32).toString('base64url');
    const id = (await pool.query('SELECT id FROM users LIMIT 1')).rows[0].id;
    await auth.repository.createSession(
      id,
      digest(token),
      digest(csrfFor('different')),
      new Date(Date.now() + 60000),
    );
    expect((await session(`gif_session=${token}`)).json()).toEqual({
      authenticated: false,
    });
    const failed = createApp(
      { database: async () => {}, storage: async () => {} },
      false,
      {
        ...options,
        repository: {
          ...auth.repository,
          findUser: async () => {
            throw new Error('sensitive-sentinel');
          },
        },
      },
    );
    try {
      const response = await failed.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: { email: 'missing@local.test', password },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body.includes('sensitive-sentinel')).toBe(false);
    } finally {
      await failed.close();
    }
  });
});
