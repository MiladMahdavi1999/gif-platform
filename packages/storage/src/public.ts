import type { ReviewVariant } from '@gif/contracts';
import { createReviewStorage, ReviewMediaFault } from './review.js';
import type { StorageConfig } from './uploads.js';

export class PublicMediaFault extends Error {
  readonly status = 503;
  readonly code = 'MEDIA_UNAVAILABLE';
  constructor(public confirmed: boolean) {
    super('Media unavailable. Please retry.');
  }
}
/** Reuse exact-version, bounded SHA256 verification; no unverified bytes leave the API. */
export function createPublicStorage(
  config: StorageConfig & { MAX_GIF_OUTPUT_BYTES?: number },
) {
  const derivatives = createReviewStorage(config);
  return {
    async read(value: ReviewVariant) {
      try {
        const bytes = await derivatives.read(value);
        const validSignature =
          value.name === 'DISPLAY_GIF'
            ? ['GIF87a', 'GIF89a'].includes(
                bytes.subarray(0, 6).toString('ascii'),
              )
            : bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!validSignature) throw new PublicMediaFault(true);
        return bytes;
      } catch (error) {
        if (error instanceof PublicMediaFault) throw error;
        // Missing pinned version and integrity mismatches are confirmed; outages/timeouts are not.
        throw new PublicMediaFault(
          error instanceof ReviewMediaFault &&
            error.code === 'DERIVATIVES_UNVERIFIED',
        );
      }
    },
    close: derivatives.close,
  };
}
export type PublicStorage = ReturnType<typeof createPublicStorage>;
