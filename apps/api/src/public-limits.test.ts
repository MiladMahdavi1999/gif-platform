import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { PublicLimiter } from './public-limits.js';
import type { PublicOptions } from './public.js';
const id = '11111111-1111-4111-8111-111111111111';
const options = (
  read: () => Promise<Buffer<ArrayBuffer>> = async () => Buffer.from('safe'),
): PublicOptions => ({
  repository: {
    list: async () => ({ items: [] }),
    detail: async () => {
      throw new Error('secret private storage key');
    },
    media: async () => ({ value: {} as never, values: [] }),
    authorize: async () => {},
    degrade: async () => {},
  },
  storage: { read, close: () => {} },
  cacheSeconds: 30,
  readLimitPerMinute: 2,
  mediaLimitPerMinute: 2,
  maxConcurrentMedia: 1,
});
const health = { database: async () => {}, storage: async () => {} };
describe('B08 public guardrails', () => {
  it('expires windows and fails closed at bounded peer capacity', () => {
    let now = 0;
    const limiter = new PublicLimiter(1, () => now, 1);
    expect(limiter.consume('peer')).toBe(0);
    expect(limiter.consume('peer')).toBe(60);
    expect(limiter.consume('new-peer')).toBe(60);
    now = 60000;
    expect(limiter.consume('new-peer')).toBe(0);
  });
  it('bounds shared gallery/Picker search and detail retries, ignores forwarded IP, and preserves health', async () => {
    const app = createApp(
      health,
      false,
      undefined,
      undefined,
      undefined,
      options(),
    );
    try {
      expect((await app.inject('/api/v1/public/gifs')).statusCode).toBe(200);
      const failed = await app.inject(`/api/v1/public/gifs/${id}`);
      expect(failed.statusCode).toBe(503);
      expect(failed.json().error.message).toBe(
        'Public service unavailable. Please retry.',
      );
      expect(failed.headers['x-request-id']).toBe(
        failed.json().error.requestId,
      );
      expect(failed.body).not.toMatch(/secret|storage key/);
      const limited = await app.inject({
        url: '/api/v1/public/gifs',
        headers: { 'x-forwarded-for': 'spoofed' },
      });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['cache-control']).toBe('no-store');
      expect((await app.inject('/api/v1/health/live')).statusCode).toBe(200);
      expect((await app.inject('/api/v1/health/ready')).statusCode).toBe(200);
      expect((await app.inject('/api/v1/internal/operations')).statusCode).toBe(
        404,
      );
    } finally {
      await app.close();
    }
  });
  it('bounds active media reads, releases on failure, and separately rate limits media retries', async () => {
    let reject!: (error: Error) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<Buffer<ArrayBuffer>>((_resolve, rejectValue) => {
      reject = rejectValue;
    });
    const app = createApp(
      health,
      false,
      undefined,
      undefined,
      undefined,
      options(async () => {
        started();
        return gate;
      }),
    );
    try {
      const first = app.inject(`/media/${id}/poster.png`).then((r) => r);
      await ready;
      const busy = await app.inject(`/media/${id}/poster.png`);
      expect(busy.statusCode).toBe(503);
      expect(busy.json().error.code).toBe('MEDIA_BUSY');
      reject(new Error('private decoder /tmp/private'));
      expect((await first).statusCode).toBe(503);
      expect((await app.inject(`/media/${id}/poster.png`)).statusCode).toBe(
        429,
      );
      // Independent peers share the in-flight cap, but have independent rate windows.
      const next = await app.inject({
        url: `/media/${id}/poster.png`,
        remoteAddress: '127.0.0.2',
      });
      expect(next.statusCode).toBe(503);
      expect(next.json().error.code).toBe('PUBLIC_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });
});
