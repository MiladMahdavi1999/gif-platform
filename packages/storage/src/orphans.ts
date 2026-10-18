import { createHash } from 'node:crypto';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { assetIdSchema } from '@gif/contracts';
import { s3Client, type StorageConfig } from './uploads.js';

/** Detection only: a PG snapshot cannot fence concurrent S3 uploads or future pins. */
export async function detectOrphans(
  config: StorageConfig,
  assetId: string,
  references: { keys: string[]; protectScope: boolean },
) {
  assetId = assetIdSchema.parse(assetId).toLowerCase();
  const client = s3Client(config);
  const objects: {
    reference: string;
    storage: string;
    classification: string;
  }[] = [];
  let truncated = false;
  try {
    // No user-provided bucket, prefix, pagination token or delete operation.
    for (const [Bucket, Prefix, storage] of [
      [config.S3_QUARANTINE_BUCKET, `quarantine/${assetId}/`, 'quarantine'],
      [config.S3_DERIVATIVES_BUCKET, `assets/${assetId}/`, 'derivatives'],
    ] as const) {
      const result = await client.send(
        new ListObjectVersionsCommand({ Bucket, Prefix, MaxKeys: 100 }),
        { abortSignal: AbortSignal.timeout(4000) },
      );
      truncated ||= Boolean(result.IsTruncated);
      for (const value of [
        ...(result.Versions ?? []),
        ...(result.DeleteMarkers ?? []),
      ]) {
        if (!value.Key?.startsWith(Prefix) || !value.VersionId)
          throw new Error('Invalid storage listing');
        objects.push({
          reference: createHash('sha256')
            .update(JSON.stringify([Bucket, value.Key, value.VersionId]))
            .digest('hex'),
          storage,
          classification:
            references.protectScope || references.keys.includes(value.Key)
              ? 'PROTECTED'
              : 'MANUAL_REVIEW_ONLY',
        });
      }
    }
    return {
      assetId,
      mode: 'DETECTION_ONLY',
      deletionPermitted: false,
      truncated,
      objects,
    };
  } finally {
    client.destroy();
  }
}
