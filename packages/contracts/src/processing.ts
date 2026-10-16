/** Safe persisted codes only; never persist decoder or SDK messages. */
export const processingErrorCodes = [
  'MEDIA_INVALID',
  'MEDIA_NOT_ANIMATED',
  'MEDIA_TOO_LARGE',
  'MEDIA_TOO_LONG',
  'MEDIA_DIMENSIONS_EXCEEDED',
  'MEDIA_FRAMES_EXCEEDED',
  'MEDIA_DECODE_FAILED',
  'MEDIA_TIMEOUT',
  'MEDIA_OUTPUT_TOO_LARGE',
  'SOURCE_VERSION_MISSING',
  'SOURCE_INTEGRITY_MISMATCH',
  'STORAGE_TEMPORARY',
  'STORAGE_INTEGRITY',
  'FFMPEG_RESOURCE_TRANSIENT',
  'DATABASE_TEMPORARY',
  'LEASE_EXPIRED',
  'ATTEMPTS_EXHAUSTED',
] as const;
export type ProcessingErrorCode = (typeof processingErrorCodes)[number];
export interface VerifiedVariant {
  name: 'DISPLAY_GIF' | 'POSTER_PNG';
  objectKey: string;
  objectVersionId: string;
  mimeType: 'image/gif' | 'image/png';
  sizeBytes: number;
  width: number;
  height: number;
  durationMs: number | null;
  frameCount: number;
  sha256: string;
}
export class ProcessingFault extends Error {
  constructor(
    public code: ProcessingErrorCode,
    public retryable = false,
  ) {
    super(code);
  }
}
