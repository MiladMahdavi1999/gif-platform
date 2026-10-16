import { describe, it, expect } from 'vitest';
import { createPublicCursor } from './public-cursor.js';
import { publicQuerySchema } from '@gif/contracts';
const secret = 'independent_cursor_signing_test_secret_32_bytes';
const position = {
  rank: 0.12345679,
  createdAt: '2026-01-02T03:04:05.123456Z',
  id: 'a3c85156-f704-4f1a-9da3-40c8e3ed705a',
};
describe('signed public keyset cursor', () => {
  it('preserves rank and PostgreSQL microseconds across restarts with the same key', () => {
    const value = createPublicCursor(secret).encode(position, 'hello', 'owned');
    expect(createPublicCursor(secret).decode(value, 'HELLO', 'owned')).toEqual(
      position,
    );
  });
  it('rejects tampering, changed search, changed tag and a different signing key', () => {
    const codec = createPublicCursor(secret),
      value = codec.encode(position, 'hello', 'owned');
    for (const run of [
      () => codec.decode(value + 'x', 'hello', 'owned'),
      () => codec.decode(value, 'changed', 'owned'),
      () => codec.decode(value, 'hello'),
      () =>
        createPublicCursor(secret + 'other').decode(value, 'hello', 'owned'),
      () => codec.decode('not.a.cursor', 'hello', 'owned'),
    ])
      expect(run).toThrow('Invalid cursor');
  });
  it('bounds query inputs and normalizes exact tag discovery', () => {
    expect(publicQuerySchema.parse({ q: '  Hello  ', tag: ' OWNED ' })).toEqual(
      { q: 'Hello', tag: 'owned', limit: 24 },
    );
    for (const query of [
      { limit: 51 },
      { q: 'x'.repeat(101) },
      { cursor: 'x'.repeat(2049) },
      { unknown: 'value' },
    ])
      expect(publicQuerySchema.safeParse(query).success).toBe(false);
  });
});
