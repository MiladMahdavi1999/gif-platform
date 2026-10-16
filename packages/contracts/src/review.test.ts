import { expect, it } from 'vitest';
import {
  decisionRequestSchema,
  removalRequestSchema,
  reviewQuerySchema,
} from './review.js';
it('validates action-specific reasons and a safe exact optimistic version', () => {
  expect(
    decisionRequestSchema.safeParse({
      decision: 'APPROVE',
      reasonCode: 'POLICY_PASSED',
      expectedVersion: 1,
    }).success,
  ).toBe(true);
  expect(
    decisionRequestSchema.safeParse({
      decision: 'REJECT',
      reasonCode: 'RIGHTS_CONCERN',
      reasonNote: ' check ',
      expectedVersion: 2,
    }).success,
  ).toBe(true);
  for (const expectedVersion of [0, -1, 1.1, Number.MAX_SAFE_INTEGER, '1'])
    expect(
      removalRequestSchema.safeParse({
        reasonCode: 'RIGHTS_REQUEST',
        expectedVersion,
      }).success,
    ).toBe(false);
  for (const input of [
    { decision: 'REJECT', reasonCode: 'POLICY_PASSED', expectedVersion: 1 },
    { decision: 'APPROVE', reasonCode: 'RIGHTS_CONCERN', expectedVersion: 1 },
    { decision: 'REJECT', expectedVersion: 1 },
    {
      decision: 'APPROVE',
      reasonCode: 'POLICY_PASSED',
      expectedVersion: 1,
      ownerId: 'spoof',
    },
  ])
    expect(decisionRequestSchema.safeParse(input).success).toBe(false);
  expect(reviewQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
  expect(reviewQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
});
