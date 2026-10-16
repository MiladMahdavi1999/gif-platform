import { describe, expect, it } from 'vitest';
import {
  uploadRequestSchema,
  idempotencyKeySchema,
  completeRequestSchema,
} from './uploads.js';
const valid = {
  kind: 'GIF',
  title: ' My animation ',
  tags: [' Original ', 'آزمایش'],
  rightsAttested: true,
  rightsAttestationVersion: 'v1',
  claimedSizeBytes: 85,
};
describe('private upload contract', () => {
  it('normalizes title and tags without accepting extra fields', () => {
    expect(uploadRequestSchema.parse(valid)).toMatchObject({
      title: 'My animation',
      tags: ['original', 'آزمایش'],
    });
    expect(
      uploadRequestSchema.safeParse({ ...valid, key: 'arbitrary' }).success,
    ).toBe(false);
    expect(completeRequestSchema.safeParse({ key: 'arbitrary' }).success).toBe(
      false,
    );
  });
  it.each([
    { kind: 'STICKER' },
    { rightsAttested: false },
    { rightsAttestationVersion: 'v2' },
    { title: ' ' },
    { tags: ['one', ' ONE '] },
    { tags: Array(11).fill('a') },
    { claimedSizeBytes: 0 },
    { claimedSizeBytes: 1.1 },
  ])('rejects invalid metadata %j', (patch) => {
    expect(uploadRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  });
  it('bounds safe idempotency keys', () => {
    expect(idempotencyKeySchema.safeParse('original-upload_123').success).toBe(
      true,
    );
    for (const key of ['short', 'a'.repeat(129), 'untrusted\nheader'])
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});
