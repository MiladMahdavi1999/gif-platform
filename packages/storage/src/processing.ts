import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { s3Client, type StorageConfig } from './uploads.js';
// Deliberately no URL signing, ACL, policy, deletion or public delivery operations.
export function createProcessingStorage(config: StorageConfig) {
  const client = s3Client(config);
  return {
    async download(
      source: { key: string; versionId: string; etag: string; size: number },
      path: string,
      signal: AbortSignal,
    ) {
      if (!source.versionId || source.versionId === 'null')
        throw new Error('SOURCE_VERSION_MISSING');
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.S3_QUARANTINE_BUCKET,
          Key: source.key,
          VersionId: source.versionId,
          IfMatch: source.etag,
        }),
        { abortSignal: signal },
      );
      const body = response.Body;
      const destroy = () =>
        (body as { destroy?: () => void } | undefined)?.destroy?.();
      signal.addEventListener('abort', destroy, { once: true });
      let file: FileHandle | undefined;
      let size = 0;
      const hash = createHash('sha256');
      try {
        signal.throwIfAborted();
        file = await open(path, 'wx', 0o600);
        if (
          !body ||
          response.VersionId !== source.versionId ||
          response.ETag !== source.etag ||
          response.ContentLength !== source.size ||
          response.ContentType !== 'image/gif'
        )
          throw new Error('SOURCE_INTEGRITY_MISMATCH');
        for await (const data of body as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          size += data.length;
          if (size > Math.min(source.size, config.MAX_GIF_UPLOAD_BYTES))
            throw new Error('SOURCE_INTEGRITY_MISMATCH');
          hash.update(data);
          await file.writeFile(data);
        }
        signal.throwIfAborted();
        if (size !== source.size) throw new Error('SOURCE_INTEGRITY_MISMATCH');
        return hash.digest('hex');
      } finally {
        signal.removeEventListener('abort', destroy);
        destroy();
        await file?.close();
      }
    },
    async putVerified(
      key: string,
      bytes: Buffer,
      contentType: string,
      sha256: string,
      signal: AbortSignal,
    ) {
      // Content-addressed key + conditional create makes retry/crash writes immutable.
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.S3_DERIVATIVES_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            IfNoneMatch: '*',
            ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
            Metadata: { sha256 },
          }),
          { abortSignal: signal },
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 412
        )
          throw error;
      }
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: config.S3_DERIVATIVES_BUCKET,
          Key: key,
          ChecksumMode: 'ENABLED',
        }),
        { abortSignal: signal },
      );
      if (
        head.ContentLength !== bytes.length ||
        head.ContentType !== contentType ||
        head.Metadata?.sha256 !== sha256 ||
        head.ChecksumSHA256 !== Buffer.from(sha256, 'hex').toString('base64') ||
        !head.VersionId ||
        head.VersionId === 'null'
      )
        throw new Error('STORAGE_INTEGRITY');
      // HEAD exact immutable version too, rather than relying only on latest lookup.
      const pinned = await client.send(
        new HeadObjectCommand({
          Bucket: config.S3_DERIVATIVES_BUCKET,
          Key: key,
          VersionId: head.VersionId,
          ChecksumMode: 'ENABLED',
        }),
        { abortSignal: signal },
      );
      if (
        pinned.ETag !== head.ETag ||
        pinned.ContentLength !== bytes.length ||
        pinned.ChecksumSHA256 !== head.ChecksumSHA256
      )
        throw new Error('STORAGE_INTEGRITY');
      return head.VersionId;
    },
    close: () => client.destroy(),
  };
}
export type ProcessingStorage = ReturnType<typeof createProcessingStorage>;
