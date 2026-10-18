import {
  S3Client,
  HeadObjectCommand,
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  PutBucketVersioningCommand,
  HeadBucketCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

export interface StorageConfig {
  S3_INTERNAL_ENDPOINT: string;
  S3_PUBLIC_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_QUARANTINE_BUCKET: string;
  S3_DERIVATIVES_BUCKET: string;
  MAX_GIF_UPLOAD_BYTES: number;
}
export interface ObjectHead {
  size: number;
  contentType: string;
  etag: string;
  versionId: string;
}
export interface UploadStorage {
  sign(
    key: string,
    expiresAt: Date,
  ): Promise<{ url: string; fields: Record<string, string> }>;
  head(key: string): Promise<ObjectHead | null>;
}
export function s3Client(config: StorageConfig, browser = false) {
  return new S3Client({
    endpoint: browser ? config.S3_PUBLIC_ENDPOINT : config.S3_INTERNAL_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1500, requestTimeout: 3000 },
  });
}
export function createUploadStorage(config: StorageConfig) {
  const internal = s3Client(config);
  const browser = s3Client(config, true);
  const storage: UploadStorage = {
    async sign(key, expiresAt) {
      const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      if (seconds < 1) throw new Error('Upload policy expired');
      return createPresignedPost(browser, {
        Bucket: config.S3_QUARANTINE_BUCKET,
        Key: key,
        Expires: seconds,
        Fields: { 'Content-Type': 'image/gif', success_action_status: '204' },
        Conditions: [
          ['content-length-range', 1, config.MAX_GIF_UPLOAD_BYTES],
          ['eq', '$Content-Type', 'image/gif'],
          ['eq', '$success_action_status', '204'],
        ],
      });
    },
    async head(key) {
      try {
        const value = await internal.send(
          new HeadObjectCommand({
            Bucket: config.S3_QUARANTINE_BUCKET,
            Key: key,
          }),
        );
        return {
          size: value.ContentLength ?? 0,
          contentType: value.ContentType ?? '',
          etag: value.ETag ?? '',
          versionId: value.VersionId ?? '',
        };
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return null;
        throw error;
      }
    },
  };
  return {
    storage,
    close: () => {
      internal.destroy();
      browser.destroy();
    },
  };
}

/** Development provisioning only, invoked explicitly by the guarded CLI. No public policy. */
export async function provisionPrivateStorage(config: StorageConfig) {
  const client = s3Client(config);
  try {
    for (const Bucket of [
      config.S3_QUARANTINE_BUCKET,
      config.S3_DERIVATIVES_BUCKET,
    ]) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 404
        )
          throw error;
        await client.send(new CreateBucketCommand({ Bucket }));
      }
      await client.send(new DeleteBucketPolicyCommand({ Bucket }));
    }
    for (const Bucket of [
      config.S3_QUARANTINE_BUCKET,
      config.S3_DERIVATIVES_BUCKET,
    ]) {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
    }
  } finally {
    client.destroy();
  }
}
export async function checkUploadStorage(config: StorageConfig) {
  const client = s3Client(config);
  try {
    const abortSignal = AbortSignal.timeout(3000);
    await Promise.all(
      [config.S3_QUARANTINE_BUCKET, config.S3_DERIVATIVES_BUCKET].map(
        async (Bucket) => {
          await client.send(new HeadBucketCommand({ Bucket }), { abortSignal });
          const versioning = await client.send(
            new GetBucketVersioningCommand({ Bucket }),
            { abortSignal },
          );
          if (versioning.Status !== 'Enabled')
            throw new Error('Private bucket versioning is required');
        },
      ),
    );
  } finally {
    client.destroy();
  }
}
