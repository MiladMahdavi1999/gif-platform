import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readWorkerConfig } from '@gif/config';
import { animatedGif } from '@gif/testing';
import { renderGif, runDecoder } from './decoder.js';
const config = readWorkerConfig({
  DATABASE_URL: 'postgresql://local:local_password@localhost/gif_platform_test',
  PUBLIC_BASE_URL: 'http://localhost:8080',
  S3_INTERNAL_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'local_access_key',
  S3_SECRET_ACCESS_KEY: 'local_storage_password',
});
async function render(bytes: Buffer, patch: Partial<typeof config> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gif-test-'));
  try {
    await writeFile(join(dir, 'input.gif'), bytes);
    return await renderGif(
      join(dir, 'input.gif'),
      { ...config, ...patch },
      new AbortController().signal,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe('real sandboxed GIF decoding', () => {
  it('processes a 165x293, 93-frame GIF larger than the pipe seek-back buffer', async () => {
    const bytes = animatedGif({ width: 165, height: 293, frameCount: 93 });
    expect(bytes.length).toBeGreaterThan(32768);
    const result = await render(bytes);
    expect(
      result.map((v) => [
        v.name,
        v.width,
        v.height,
        v.frameCount,
        v.durationMs,
      ]),
    ).toEqual([
      ['DISPLAY_GIF', 165, 293, 93, 9300],
      ['POSTER_PNG', 165, 293, 1, null],
    ]);
  });
  it('re-encodes animated GIF and real static PNG with actual metadata and SHA-256', async () => {
    const result = await render(animatedGif());
    expect(
      result.map((v) => [
        v.name,
        v.width,
        v.height,
        v.frameCount,
        v.durationMs,
      ]),
    ).toEqual([
      ['DISPLAY_GIF', 1, 1, 2, 200],
      ['POSTER_PNG', 1, 1, 1, null],
    ]);
    expect(result[0]!.bytes.equals(animatedGif())).toBe(false);
    expect(result[1]!.bytes.subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    );
    expect(result.every((v) => /^[a-f0-9]{64}$/.test(v.sha256))).toBe(true);
  });
  it('reports controlled stages while preserving safe codes and resource failures', async () => {
    for (const [bytes, patch, code, stage] of [
      [
        Buffer.from('private-path-and-content'),
        {},
        'MEDIA_INVALID',
        'input_validation',
      ],
      [
        animatedGif({ frameCount: 301 }),
        {},
        'MEDIA_FRAMES_EXCEEDED',
        'source_probe',
      ],
      [
        animatedGif(),
        { MAX_GIF_OUTPUT_BYTES: 10 },
        'MEDIA_OUTPUT_TOO_LARGE',
        'display_render',
      ],
    ] as const) {
      try {
        await render(bytes, patch);
        expect.fail('Expected a decoder fault');
      } catch (error) {
        expect(error).toMatchObject({
          code,
          message: code,
          stage,
          retryable: false,
        });
        expect(JSON.stringify(error)).not.toMatch(
          /private-path|stderr|input.gif|gif-test-/,
        );
        expect(error).not.toHaveProperty('cause');
      }
    }
  });
  it('rejects still, malformed, truncated, and wrong actual bytes', async () => {
    const animated = animatedGif();
    const still = Buffer.concat([
      animated.subarray(0, animated.length - 24),
      Buffer.from([0x3b]),
    ]);
    await expect(render(still)).rejects.toMatchObject({
      code: 'MEDIA_NOT_ANIMATED',
    });
    for (const value of [
      Buffer.from('wrong bytes'),
      animated.subarray(0, animated.length - 1),
      Buffer.from('GIF89a malformed;'),
    ])
      await expect(render(value)).rejects.toHaveProperty('code');
    const corrupt = Buffer.from(animated);
    corrupt[60] = 255;
    await expect(render(corrupt)).rejects.toHaveProperty('code');
  });
  it('enforces dimensions, pixels, duration, frames, input bytes, time and output bytes', async () => {
    const huge = Buffer.from(animatedGif());
    huge.writeUInt16LE(60000, 6);
    await expect(render(huge)).rejects.toMatchObject({
      code: 'MEDIA_DIMENSIONS_EXCEEDED',
    });
    for (const [patch, code] of [
      [{ MAX_GIF_UPLOAD_BYTES: 10 }, 'MEDIA_TOO_LARGE'],
      [{ MAX_GIF_DURATION_SECONDS: 0.15 }, 'MEDIA_TOO_LONG'],
      [{ MAX_GIF_FRAMES: 1 }, 'MEDIA_FRAMES_EXCEEDED'],
      [{ MEDIA_EXECUTION_TIMEOUT_MS: 1 }, 'MEDIA_TIMEOUT'],
      [{ MAX_GIF_OUTPUT_BYTES: 10 }, 'MEDIA_OUTPUT_TOO_LARGE'],
    ] as const)
      await expect(render(animatedGif(), patch)).rejects.toMatchObject({
        code,
      });
  });
  it('cannot open a local path even with a fixed decoder binary, and never exposes stderr or paths', async () => {
    await expect(
      runDecoder(
        'ffprobe',
        ['-v', 'error', '-i', '/etc/passwd'],
        Buffer.alloc(0),
        1024,
        1000,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ message: 'MEDIA_DECODE_FAILED' });
  });
});

it('proves OS file/network/process denial and hard memory/CPU/fd/core budgets', () => {
  const output = execFileSync(process.cwd() + '/work/decoder-probe', [], {
    env: { LD_PRELOAD: process.cwd() + '/infra/decoder/sandbox.so' },
    encoding: 'utf8',
  });
  expect(output.trim()).toBe(
    'FILES_NETWORK_PROCESSES_DENIED_RESOURCE_LIMITS_SET',
  );
});

it('rejects original fixtures beyond default duration and frame limits before rendering', async () => {
  await expect(render(animatedGif({ frameCount: 301 }))).rejects.toMatchObject({
    code: 'MEDIA_FRAMES_EXCEEDED',
  });
  await expect(
    render(animatedGif({ delayCentiseconds: 1600 })),
  ).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
  const pixels = Buffer.from(animatedGif());
  pixels.writeUInt16LE(2, 6);
  await expect(render(pixels, { MAX_GIF_PIXELS: 1 })).rejects.toMatchObject({
    code: 'MEDIA_DIMENSIONS_EXCEEDED',
  });
});
