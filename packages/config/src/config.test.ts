import { describe, expect, it } from 'vitest';
import { readApiConfig, readWorkerConfig } from './index.js';

const valid = {
  DATABASE_URL: 'postgresql://local:local_password@db:5432/gif_platform',
  PUBLIC_BASE_URL: 'http://localhost:8080',
  S3_INTERNAL_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'local_access_key',
  S3_SECRET_ACCESS_KEY: 'local_storage_password',
};

describe('configuration', () => {
  it('accepts local topology and defaults the API port', () => {
    const config = readApiConfig(valid);
    expect(config.PORT).toBe(4000);
    expect(config.S3_INTERNAL_ENDPOINT).not.toBe(config.S3_PUBLIC_ENDPOINT);
  });
  it('requires real dependency configuration', () => {
    expect(() => readApiConfig({})).toThrow(/DATABASE_URL/);
  });
  it.each(['0', '65536', 'NaN'])('rejects invalid port %s', (PORT) => {
    expect(() => readApiConfig({ ...valid, PORT })).toThrow(/PORT/);
  });
  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      readApiConfig({ ...valid, DATABASE_URL: 'https://db/' }),
    ).toThrow(/DATABASE_URL/);
  });
  it.each(['file:///etc/passwd', 'http://user:private-value@minio:9000'])(
    'rejects unsafe storage endpoints',
    (S3_INTERNAL_ENDPOINT) => {
      expect(() => readApiConfig({ ...valid, S3_INTERNAL_ENDPOINT })).toThrow(
        /S3_INTERNAL_ENDPOINT/,
      );
    },
  );
  it('does not expose invalid secret values in errors', () => {
    expect(() =>
      readApiConfig({
        ...valid,
        DATABASE_URL: 'sensitive-sentinel',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toThrow(
      'Invalid configuration fields: DATABASE_URL, S3_SECRET_ACCESS_KEY',
    );
  });
  it('requires worker dependencies and bounds leases, attempts and decoder budgets', () => {
    expect(readWorkerConfig(valid).MEDIA_JOB_MAX_ATTEMPTS).toBe(3);
    expect(() => readWorkerConfig({})).toThrow(/DATABASE_URL/);
    for (const patch of [
      { MEDIA_JOB_MAX_ATTEMPTS: '0' },
      { MEDIA_JOB_LEASE_SECONDS: '0' },
      { MAX_GIF_FRAMES: '100000' },
      { MEDIA_EXECUTION_TIMEOUT_MS: '0' },
    ])
      expect(() => readWorkerConfig({ ...valid, ...patch })).toThrow(
        /Invalid worker/,
      );
  });
});

it('requires HTTPS outside development and an exact canonical CSRF origin', () => {
  expect(() => readApiConfig({ ...valid, NODE_ENV: 'production' })).toThrow(
    /PUBLIC_BASE_URL/,
  );
  expect(() =>
    readApiConfig({ ...valid, CSRF_ORIGIN: 'https://other.test' }),
  ).toThrow(/CSRF_ORIGIN/);
  expect(() =>
    readApiConfig({ ...valid, PUBLIC_BASE_URL: 'http://localhost:8080/path' }),
  ).toThrow(/PUBLIC_BASE_URL/);
  expect(
    readApiConfig({
      ...valid,
      NODE_ENV: 'production',
      PUBLIC_READ_LIMIT_PER_MINUTE: '300',
      PUBLIC_MEDIA_LIMIT_PER_MINUTE: '600',
      PUBLIC_MEDIA_MAX_CONCURRENT: '5',
      PUBLIC_CURSOR_SECRET: 'configured_production_cursor_secret_32_bytes',
      PUBLIC_BASE_URL: 'https://gif.test',
      CSRF_ORIGIN: 'https://gif.test',
      S3_INTERNAL_ENDPOINT: 'https://storage.internal.test',
      S3_PUBLIC_ENDPOINT: 'https://storage.test',
    }).SESSION_TTL_SECONDS,
  ).toBe(86400);
});
it.each(['0', '-1', '999999999'])(
  'rejects unsafe session TTL %s',
  (SESSION_TTL_SECONDS) => {
    expect(() => readApiConfig({ ...valid, SESSION_TTL_SECONDS })).toThrow(
      /SESSION_TTL_SECONDS/,
    );
  },
);
it('bounds upload policies and requires separate buckets and canonical endpoints', () => {
  for (const settings of [
    { MEDIA_UPLOAD_POLICY_TTL_SECONDS: '0' },
    { MEDIA_UPLOAD_POLICY_TTL_SECONDS: '3601' },
    { MAX_GIF_UPLOAD_BYTES: '0' },
    { MAX_GIF_UPLOAD_BYTES: '20971521' },
    { MAX_GIF_OUTPUT_BYTES: '0' },
    { MAX_GIF_OUTPUT_BYTES: '20971521' },
    {
      S3_QUARANTINE_BUCKET: 'same-bucket',
      S3_DERIVATIVES_BUCKET: 'same-bucket',
    },
    { S3_PUBLIC_ENDPOINT: 'http://localhost:9000/path' },
  ])
    expect(() => readApiConfig({ ...valid, ...settings })).toThrow(
      /Invalid configuration/,
    );
  const config = readApiConfig({
    ...valid,
    MAX_GIF_UPLOAD_BYTES: '100',
    MAX_GIF_OUTPUT_BYTES: '1024',
  });
  expect(config.MAX_GIF_OUTPUT_BYTES).toBe(1024);
  expect(config.MAX_GIF_UPLOAD_BYTES).toBe(100);
});

it('requires a cursor signing key outside development and bounds public cache TTL', () => {
  expect(() =>
    readApiConfig({
      ...valid,
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://gif.test',
      S3_INTERNAL_ENDPOINT: 'https://storage.test',
      S3_PUBLIC_ENDPOINT: 'https://storage.test',
    }),
  ).toThrow(/PUBLIC_CURSOR_SECRET/);
  for (const PUBLIC_MEDIA_CACHE_SECONDS of ['-1', '31'])
    expect(() =>
      readApiConfig({ ...valid, PUBLIC_MEDIA_CACHE_SECONDS }),
    ).toThrow(/PUBLIC_MEDIA_CACHE_SECONDS/);
  expect(() =>
    readApiConfig({ ...valid, PUBLIC_CURSOR_SECRET: 'short' }),
  ).toThrow(/PUBLIC_CURSOR_SECRET/);
});
it('B08 bounds public resource settings and requires explicit production budgets', () => {
  for (const patch of [
    { PUBLIC_READ_LIMIT_PER_MINUTE: '0' },
    { PUBLIC_MEDIA_LIMIT_PER_MINUTE: '-1' },
    { PUBLIC_MEDIA_MAX_CONCURRENT: '6' },
  ])
    expect(() => readApiConfig({ ...valid, ...patch })).toThrow(
      /Invalid configuration/,
    );
  expect(() =>
    readApiConfig({
      ...valid,
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://gif.test',
      S3_INTERNAL_ENDPOINT: 'https://storage.test',
      S3_PUBLIC_ENDPOINT: 'https://storage.test',
      PUBLIC_CURSOR_SECRET: 'explicit_cursor_signing_key_32_bytes',
    }),
  ).toThrow(/explicit public resource limits/);
});
