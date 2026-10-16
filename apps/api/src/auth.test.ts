import { describe, expect, it } from 'vitest';
import { LoginLimiter, csrfFor, digest } from './auth.js';

describe('login retry guard', () => {
  it('limits normalized accounts across IPs and expires windows', () => {
    let now = 0;
    const limiter = new LoginLimiter(2, 4, 10000, 100, () => now);
    expect(limiter.consume('1', 'account')).toBe(0);
    expect(limiter.consume('2', 'account')).toBe(0);
    expect(limiter.consume('3', 'account')).toBe(10);
    now = 10000;
    expect(limiter.consume('3', 'account')).toBe(0);
  });
  it('limits an IP across accounts and fails closed at capacity', () => {
    const limiter = new LoginLimiter(5, 2);
    expect(limiter.consume('1', 'a')).toBe(0);
    expect(limiter.consume('1', 'b')).toBe(0);
    expect(limiter.consume('1', 'c')).toBeGreaterThan(0);
    const bounded = new LoginLimiter(10, 10, 1000, 2);
    expect(bounded.consume('1', 'a')).toBe(0);
    expect(bounded.consume('2', 'b')).toBeGreaterThan(0);
  });
  it('binds stable CSRF tokens to each opaque session', () => {
    expect(csrfFor('first')).toBe(csrfFor('first'));
    expect(csrfFor('first')).not.toBe(csrfFor('second'));
    expect(digest(csrfFor('first'))).toHaveLength(32);
  });
});
