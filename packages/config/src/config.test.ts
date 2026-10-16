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
  it('validates the no-op worker without requiring future job settings', () => {
    expect(readWorkerConfig({ NODE_ENV: 'production' })).toEqual({
      NODE_ENV: 'production',
    });
    expect(() => readWorkerConfig({ NODE_ENV: 'invalid' })).toThrow(/NODE_ENV/);
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
      PUBLIC_BASE_URL: 'https://gif.test',
      CSRF_ORIGIN: 'https://gif.test',
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
