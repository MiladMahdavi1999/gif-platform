import { describe, expect, it } from 'vitest';
import { readinessSchema } from '@gif/contracts';
import { createApp } from './app.js';

const up = async () => {};
const down = async () => {
  throw new Error('sensitive-sentinel: connection details');
};

describe('B00 health API', () => {
  it('keeps liveness separate from unavailable dependencies', async () => {
    const app = createApp({ database: down, storage: down });
    try {
      const response = await app.inject('/api/v1/health/live');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(response.headers['x-request-id']).toBeTruthy();
    } finally {
      await app.close();
    }
  });
  it('is ready only when both real probe callbacks succeed', async () => {
    const app = createApp({ database: up, storage: up });
    try {
      const response = await app.inject('/api/v1/health/ready');
      expect(response.statusCode).toBe(200);
      expect(readinessSchema.parse(response.json())).toEqual({
        status: 'ready',
        checks: { database: 'up', storage: 'up' },
      });
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it.each([
    ['database', down, up, { database: 'down', storage: 'up' }],
    ['storage', up, down, { database: 'up', storage: 'down' }],
    ['both', down, down, { database: 'down', storage: 'down' }],
  ] as const)(
    'reports 503 for %s failure without leaking errors',
    async (_label, database, storage, checks) => {
      const app = createApp({ database, storage });
      try {
        const response = await app.inject('/api/v1/health/ready');
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ status: 'not_ready', checks });
        expect(response.body).not.toContain('sensitive-sentinel');
      } finally {
        await app.close();
      }
    },
  );
  it('leaves product routes unimplemented', async () => {
    const app = createApp({ database: up, storage: up });
    try {
      for (const url of [
        '/api/v1/auth/login',
        '/api/v1/uploads',
        '/media/example',
        '/health/ready',
      ]) {
        expect((await app.inject(url)).statusCode).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
  it('does not reflect untrusted request IDs, unmatched paths or private query data', async () => {
    const app = createApp({ database: up, storage: up });
    try {
      const response = await app.inject({
        url: '/private-sentinel?token=secret',
        headers: { 'x-request-id': 'private-sentinel' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toMatch(/sentinel|token|secret/);
      expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
      expect(response.json().error.requestId).toBe(
        response.headers['x-request-id'],
      );
    } finally {
      await app.close();
    }
  });
});
