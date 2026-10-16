import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { ReviewVariant } from '@gif/contracts';
import { s3Client, type StorageConfig } from './uploads.js';

export class ReviewMediaFault extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super('Private preview unavailable');
  }
}
/** Derivative bucket only: no source bucket, arbitrary key, redirect or signed URL. */
export function createReviewStorage(
  config: StorageConfig & { MAX_GIF_OUTPUT_BYTES?: number },
) {
  const client = s3Client(config);
  function validate(v: ReviewVariant) {
    if (
      !/^assets\/[a-f0-9-]{36}\/v[1-9][0-9]*\/[a-f0-9]{64}\/(display\.gif|poster\.png)$/.test(
        v.objectKey,
      ) ||
      !v.objectVersionId ||
      v.objectVersionId === 'null' ||
      v.sizeBytes > (config.MAX_GIF_OUTPUT_BYTES ?? 20971520) ||
      v.sizeBytes < 1
    )
      throw new ReviewMediaFault(409, 'DERIVATIVES_UNVERIFIED');
  }
  function check(
    v: ReviewVariant,
    response: {
      VersionId?: string | undefined;
      ContentLength?: number | undefined;
      ContentType?: string | undefined;
      ChecksumSHA256?: string | undefined;
      Metadata?: Record<string, string> | undefined;
    },
  ) {
    if (
      response.VersionId !== v.objectVersionId ||
      response.ContentLength !== v.sizeBytes ||
      response.ContentType !== v.mimeType ||
      response.Metadata?.sha256 !== v.sha256 ||
      response.ChecksumSHA256 !==
        Buffer.from(v.sha256, 'hex').toString('base64')
    )
      throw new ReviewMediaFault(409, 'DERIVATIVES_UNVERIFIED');
  }
  async function safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ReviewMediaFault) throw error;
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        throw new ReviewMediaFault(409, 'DERIVATIVES_UNVERIFIED');
      throw new ReviewMediaFault(503, 'REVIEW_MEDIA_UNAVAILABLE');
    }
  }
  return {
    async verify(values: ReviewVariant[]) {
      await safe(async () => {
        for (const v of values) {
          validate(v);
          check(
            v,
            await client.send(
              new HeadObjectCommand({
                Bucket: config.S3_DERIVATIVES_BUCKET,
                Key: v.objectKey,
                VersionId: v.objectVersionId,
                ChecksumMode: 'ENABLED',
              }),
              { abortSignal: AbortSignal.timeout(3500) },
            ),
          );
        }
      });
    },
    async read(v: ReviewVariant) {
      return safe(async () => {
        validate(v);
        const signal = AbortSignal.timeout(4000);
        const response = await client.send(
          new GetObjectCommand({
            Bucket: config.S3_DERIVATIVES_BUCKET,
            Key: v.objectKey,
            VersionId: v.objectVersionId,
            ChecksumMode: 'ENABLED',
          }),
          { abortSignal: signal },
        );
        const body = response.Body;
        try {
          check(v, response);
          if (!body)
            throw new ReviewMediaFault(503, 'REVIEW_MEDIA_UNAVAILABLE');
          const chunks: Uint8Array[] = [];
          let length = 0;
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            signal.throwIfAborted();
            length += chunk.length;
            if (length > v.sizeBytes)
              throw new ReviewMediaFault(409, 'DERIVATIVES_UNVERIFIED');
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          if (
            length !== v.sizeBytes ||
            createHash('sha256').update(bytes).digest('hex') !== v.sha256
          )
            throw new ReviewMediaFault(409, 'DERIVATIVES_UNVERIFIED');
          return bytes;
        } finally {
          (body as { destroy?: () => void } | undefined)?.destroy?.();
        }
      });
    },
    close: () => client.destroy(),
  };
}
export type ReviewStorage = ReturnType<typeof createReviewStorage>;
