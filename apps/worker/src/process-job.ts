import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '@gif/config';
import { ProcessingFault, type VerifiedVariant } from '@gif/contracts';
import {
  StaleLease,
  type MediaLease,
  type ProcessingRepository,
} from '@gif/db';
import type { ProcessingStorage } from '@gif/storage';
import { DecoderFault, renderGif } from './decoder.js';
export async function processJob(
  lease: MediaLease,
  repository: ProcessingRepository,
  storage: ProcessingStorage,
  config: WorkerConfig,
  shutdown: AbortSignal,
  afterUploads?: () => Promise<void>,
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    shutdown,
    AbortSignal.timeout(config.MEDIA_JOB_TIMEOUT_MS),
  ]);
  let lost = false,
    beating = false;
  const heartbeat = setInterval(
    async () => {
      if (beating) return;
      beating = true;
      try {
        if (!(await repository.heartbeat(lease))) {
          lost = true;
          controller.abort();
        }
      } catch {
        lost = true;
        controller.abort();
      } finally {
        beating = false;
      }
    },
    Math.max(100, Math.floor((config.MEDIA_JOB_LEASE_SECONDS * 1000) / 3)),
  );
  let directory: string | undefined;
  let stage: 'storage' | 'processing' | 'database' = 'storage';
  try {
    if (!lease.versionId || lease.versionId === 'null')
      throw new ProcessingFault('SOURCE_VERSION_MISSING');
    if (
      !Number.isSafeInteger(lease.size) ||
      lease.size < 1 ||
      lease.size > config.MAX_GIF_UPLOAD_BYTES
    )
      throw new ProcessingFault('MEDIA_TOO_LARGE');
    directory = await mkdtemp(join(tmpdir(), 'gif-job-'));
    const path = join(directory, 'input.gif');
    const sourceSha256 = await storage.download(lease, path, signal);
    stage = 'processing';
    const outputs = await renderGif(path, config, signal);
    stage = 'storage';
    const variants: VerifiedVariant[] = [];
    for (const output of outputs) {
      signal.throwIfAborted();
      const objectKey = `assets/${lease.assetId}/v${lease.generation}/${output.sha256}/${output.name === 'DISPLAY_GIF' ? 'display.gif' : 'poster.png'}`;
      const objectVersionId = await storage.putVerified(
        objectKey,
        output.bytes,
        output.mimeType,
        output.sha256,
        signal,
      );
      const { bytes, ...metadata } = output;
      void bytes;
      variants.push({
        ...metadata,
        objectKey,
        objectVersionId,
        sizeBytes: output.bytes.length,
      });
    }
    // Tests can kill the actual process here. Production supplies no hook.
    await afterUploads?.();
    signal.throwIfAborted();
    stage = 'database';
    await repository.succeed(lease, variants, sourceSha256);
    return 'succeeded';
  } catch (error) {
    if (lost || shutdown.aborted || error instanceof StaleLease)
      return 'lease_lost';
    const message = error instanceof Error ? error.message : '';
    const failure =
      error instanceof ProcessingFault
        ? error
        : [
              'SOURCE_VERSION_MISSING',
              'SOURCE_INTEGRITY_MISMATCH',
              'STORAGE_INTEGRITY',
            ].includes(message)
          ? new ProcessingFault(message as 'STORAGE_INTEGRITY')
          : signal.aborted
            ? new ProcessingFault('MEDIA_TIMEOUT')
            : new ProcessingFault(
                stage === 'database'
                  ? 'DATABASE_TEMPORARY'
                  : stage === 'storage'
                    ? 'STORAGE_TEMPORARY'
                    : 'FFMPEG_RESOURCE_TRANSIENT',
                true,
              );
    if (error instanceof DecoderFault)
      console.log(
        JSON.stringify({
          service: 'worker',
          status: 'decoder_failed',
          stage: error.stage,
          code: error.code,
          jobId: lease.id,
          assetId: lease.assetId,
          attempt: lease.attempt,
        }),
      );
    try {
      await repository.fail(lease, failure.code, failure.retryable);
    } catch {
      return 'lease_lost';
    } // DB outage leaves durable lease to expire and recover.
    return failure.code;
  } finally {
    clearInterval(heartbeat);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
