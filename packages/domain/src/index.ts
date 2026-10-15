/** Seven independent media axes; moderation is a separate enforcement axis. */
export const mediaStateValues = {
  upload: ['INTENT', 'RECEIVED', 'EXPIRED', 'FAILED'],
  processing: [
    'NOT_STARTED',
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED_RETRYABLE',
    'FAILED_TERMINAL',
  ],
  visibility: ['PRIVATE', 'PUBLIC', 'RESTRICTED'],
  searchEligibility: ['INELIGIBLE', 'ELIGIBLE'],
  indexing: ['NOT_INDEXED', 'INDEXED', 'STALE'],
  apiAvailability: ['BLOCKED', 'ENABLED'],
  deliveryReadiness: ['NOT_READY', 'READY', 'DEGRADED'],
  moderation: ['NOT_REQUESTED', 'PENDING', 'APPROVED', 'REJECTED', 'REMOVED'],
} as const;
export type MediaState = {
  readonly [
    K in keyof typeof mediaStateValues
  ]: (typeof mediaStateValues)[K][number];
};
export type Role = 'UPLOADER' | 'REVIEWER' | 'ADMIN';
export const initialMediaState: MediaState = Object.freeze({
  upload: 'INTENT',
  processing: 'NOT_STARTED',
  visibility: 'PRIVATE',
  searchEligibility: 'INELIGIBLE',
  indexing: 'NOT_INDEXED',
  apiAvailability: 'BLOCKED',
  deliveryReadiness: 'NOT_READY',
  moderation: 'NOT_REQUESTED',
});

export class InvalidMediaTransition extends Error {
  constructor() {
    super('Invalid media state transition');
  }
}
function requireState(condition: boolean): asserts condition {
  if (!condition) throw new InvalidMediaTransition();
}
export function assertMediaState(state: MediaState): void {
  for (const key of Object.keys(mediaStateValues) as (keyof MediaState)[]) {
    requireState(
      (mediaStateValues[key] as readonly string[]).includes(state[key]),
    );
  }
  if (state.processing !== 'NOT_STARTED')
    requireState(state.upload === 'RECEIVED');
  if (state.moderation !== 'NOT_REQUESTED')
    requireState(state.processing === 'SUCCEEDED');
  if (state.deliveryReadiness !== 'NOT_READY')
    requireState(state.processing === 'SUCCEEDED');
  if (
    state.visibility === 'PUBLIC' ||
    state.searchEligibility === 'ELIGIBLE' ||
    state.apiAvailability === 'ENABLED' ||
    state.indexing === 'INDEXED'
  ) {
    requireState(
      state.moderation === 'APPROVED' && state.processing === 'SUCCEEDED',
    );
  }
}

export type MediaTransition =
  | {
      type:
        | 'RECEIVE'
        | 'EXPIRE'
        | 'UPLOAD_FAIL'
        | 'CLAIM'
        | 'RETRY'
        | 'PROCESS_FAIL_RETRYABLE'
        | 'PROCESS_FAIL_TERMINAL'
        | 'DELIVERY_LOST'
        | 'INDEX_STALE';
    }
  | {
      type: 'PROCESS_SUCCEED' | 'DELIVERY_RESTORE';
      verifiedDisplay: boolean;
      verifiedPoster: boolean;
    }
  | {
      type: 'APPROVE' | 'REJECT' | 'REMOVE';
      reviewerId: string;
      ownerId: string;
      roles: readonly Role[];
      expectedVersion: bigint;
      actualVersion: bigint;
      reasonCode: string;
      rightsAttested: boolean;
      verifiedDisplay: boolean;
      verifiedPoster: boolean;
    };

/** Pure guards only: callers must persist state, audit and projection atomically later. */
export function transitionMediaState(
  state: MediaState,
  command: MediaTransition,
): MediaState {
  assertMediaState(state);
  let next: MediaState = { ...state };
  switch (command.type) {
    case 'RECEIVE':
      requireState(
        state.upload === 'INTENT' && state.processing === 'NOT_STARTED',
      );
      next = { ...state, upload: 'RECEIVED', processing: 'QUEUED' };
      break;
    case 'EXPIRE':
    case 'UPLOAD_FAIL':
      requireState(
        state.upload === 'INTENT' && state.processing === 'NOT_STARTED',
      );
      next = {
        ...state,
        upload: command.type === 'EXPIRE' ? 'EXPIRED' : 'FAILED',
      };
      break;
    case 'CLAIM':
      requireState(state.processing === 'QUEUED');
      next = { ...state, processing: 'RUNNING' };
      break;
    case 'RETRY':
      requireState(state.processing === 'FAILED_RETRYABLE');
      next = { ...state, processing: 'QUEUED' };
      break;
    case 'PROCESS_FAIL_RETRYABLE':
    case 'PROCESS_FAIL_TERMINAL':
      requireState(state.processing === 'RUNNING');
      next = {
        ...state,
        processing:
          command.type === 'PROCESS_FAIL_RETRYABLE'
            ? 'FAILED_RETRYABLE'
            : 'FAILED_TERMINAL',
      };
      break;
    case 'PROCESS_SUCCEED':
      requireState(
        state.processing === 'RUNNING' &&
          command.verifiedDisplay &&
          command.verifiedPoster,
      );
      next = {
        ...state,
        processing: 'SUCCEEDED',
        deliveryReadiness: 'READY',
        moderation: 'PENDING',
      };
      break;
    case 'APPROVE':
    case 'REJECT':
    case 'REMOVE': {
      requireState(
        command.roles.includes('REVIEWER') &&
          command.reviewerId.length > 0 &&
          command.reviewerId !== command.ownerId,
      );
      requireState(
        command.actualVersion > 0n &&
          command.expectedVersion === command.actualVersion &&
          command.reasonCode.trim().length > 0,
      );
      requireState(
        state.processing === 'SUCCEEDED' &&
          state.moderation ===
            (command.type === 'REMOVE' ? 'APPROVED' : 'PENDING'),
      );
      if (command.type === 'APPROVE') {
        requireState(
          command.rightsAttested &&
            command.verifiedDisplay &&
            command.verifiedPoster &&
            state.deliveryReadiness === 'READY',
        );
        next = {
          ...state,
          moderation: 'APPROVED',
          visibility: 'PUBLIC',
          searchEligibility: 'ELIGIBLE',
          indexing: 'INDEXED',
          apiAvailability: 'ENABLED',
        };
      } else {
        next = {
          ...state,
          moderation: command.type === 'REJECT' ? 'REJECTED' : 'REMOVED',
          visibility: 'RESTRICTED',
          searchEligibility: 'INELIGIBLE',
          indexing: 'NOT_INDEXED',
          apiAvailability: 'BLOCKED',
        };
      }
      break;
    }
    case 'DELIVERY_LOST':
      requireState(state.deliveryReadiness === 'READY');
      next = { ...state, deliveryReadiness: 'DEGRADED' };
      break;
    case 'DELIVERY_RESTORE':
      requireState(
        state.deliveryReadiness === 'DEGRADED' &&
          command.verifiedDisplay &&
          command.verifiedPoster,
      );
      next = { ...state, deliveryReadiness: 'READY' };
      break;
    case 'INDEX_STALE':
      requireState(state.indexing === 'INDEXED');
      next = { ...state, indexing: 'STALE' };
      break;
    default: {
      const exhaustive: never = command;
      throw new Error(`Unknown transition: ${String(exhaustive)}`);
    }
  }
  assertMediaState(next);
  return Object.freeze(next);
}

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  if (
    normalized.length > 10 ||
    normalized.some((tag) => [...tag].length < 1 || [...tag].length > 64) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error('Invalid tags');
  }
  return normalized;
}
