import { describe, expect, it } from 'vitest';
import {
  assertMediaState,
  initialMediaState,
  normalizeTags,
  transitionMediaState as move,
  type MediaState,
  type MediaTransition,
} from './index.js';

const received = move(initialMediaState, { type: 'RECEIVE' });
const running = move(received, { type: 'CLAIM' });
const pending = move(running, {
  type: 'PROCESS_SUCCEED',
  verifiedDisplay: true,
  verifiedPoster: true,
});
const decision = {
  type: 'APPROVE',
  reviewerId: 'reviewer',
  ownerId: 'uploader',
  roles: ['REVIEWER'],
  expectedVersion: 1n,
  actualVersion: 1n,
  reasonCode: 'LOCAL_REVIEW',
  rightsAttested: true,
  verifiedDisplay: true,
  verifiedPoster: true,
} as const;
const approved = move(pending, decision);

describe('B01 media state guards', () => {
  it('starts private and processing never grants public permission', () => {
    expect(pending).toEqual({
      ...initialMediaState,
      upload: 'RECEIVED',
      processing: 'SUCCEEDED',
      deliveryReadiness: 'READY',
      moderation: 'PENDING',
    });
    expect(initialMediaState.upload).toBe('INTENT');
  });
  it('supports review and removal while keeping technical readiness distinct', () => {
    expect(approved.visibility).toBe('PUBLIC');
    expect(move(pending, { ...decision, type: 'REJECT' })).toEqual({
      ...pending,
      moderation: 'REJECTED',
      visibility: 'RESTRICTED',
    });
    expect(move(approved, { ...decision, type: 'REMOVE' })).toEqual({
      ...pending,
      moderation: 'REMOVED',
      visibility: 'RESTRICTED',
    });
  });
  it('changes technical delivery independently of historical approval and search axes', () => {
    const degraded = move(approved, { type: 'DELIVERY_LOST' });
    expect(degraded).toEqual({ ...approved, deliveryReadiness: 'DEGRADED' });
    expect(
      move(degraded, {
        type: 'DELIVERY_RESTORE',
        verifiedDisplay: true,
        verifiedPoster: true,
      }),
    ).toEqual(approved);
    expect(move(approved, { type: 'INDEX_STALE' })).toEqual({
      ...approved,
      indexing: 'STALE',
    });
  });
  it('handles expiry, upload failure, retries and terminal processing failure', () => {
    expect(move(initialMediaState, { type: 'EXPIRE' }).upload).toBe('EXPIRED');
    expect(move(initialMediaState, { type: 'UPLOAD_FAIL' }).upload).toBe(
      'FAILED',
    );
    const retry = move(running, { type: 'PROCESS_FAIL_RETRYABLE' });
    expect(move(retry, { type: 'RETRY' })).toEqual(received);
    expect(move(running, { type: 'PROCESS_FAIL_TERMINAL' }).processing).toBe(
      'FAILED_TERMINAL',
    );
  });
  it.each([
    { roles: ['UPLOADER'] },
    { roles: ['ADMIN'] },
    { reviewerId: 'uploader' },
    { reviewerId: '' },
    { expectedVersion: 0n },
    { reasonCode: '  ' },
    { rightsAttested: false },
    { verifiedDisplay: false },
    { verifiedPoster: false },
  ])('refuses unsafe approval context %#', (patch) => {
    expect(() =>
      move(pending, { ...decision, ...patch } as MediaTransition),
    ).toThrow('Invalid media state transition');
  });
  it.each([
    [initialMediaState, { type: 'CLAIM' }],
    [received, { type: 'RECEIVE' }],
    [
      running,
      { type: 'PROCESS_SUCCEED', verifiedDisplay: false, verifiedPoster: true },
    ],
    [initialMediaState, decision],
    [approved, decision],
    [pending, { ...decision, type: 'REMOVE' }],
    [move(initialMediaState, { type: 'EXPIRE' }), { type: 'RECEIVE' }],
    [move(running, { type: 'PROCESS_FAIL_TERMINAL' }), { type: 'RETRY' }],
    [
      pending,
      { type: 'DELIVERY_RESTORE', verifiedDisplay: true, verifiedPoster: true },
    ],
  ] as const)(
    'rejects out-of-order and repeated commands',
    (state, command) => {
      expect(() => move(state, command)).toThrow(
        'Invalid media state transition',
      );
    },
  );
  it.each([
    { upload: 'INVALID' },
    { processing: 'RUNNING' },
    { moderation: 'APPROVED' },
    { visibility: 'PUBLIC' },
    { searchEligibility: 'ELIGIBLE' },
    { indexing: 'INDEXED' },
    { apiAvailability: 'ENABLED' },
    { deliveryReadiness: 'READY' },
  ])('rejects invalid states %j', (patch) => {
    expect(() =>
      assertMediaState({ ...initialMediaState, ...patch } as MediaState),
    ).toThrow();
  });
  it('normalizes tags and rejects duplicates, empty, overlong and excess tags', () => {
    expect(normalizeTags([' Hello ', 'سلام'])).toEqual(['hello', 'سلام']);
    for (const tags of [
      ['x', ' X '],
      [''],
      ['x'.repeat(65)],
      Array.from({ length: 11 }, (_, n) => String(n)),
    ])
      expect(() => normalizeTags(tags)).toThrow();
  });
});
