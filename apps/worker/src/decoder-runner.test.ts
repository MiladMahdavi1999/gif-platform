import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { runDecoder } from './decoder.js';

it.each([
  ['', 0, 'FFMPEG_RESOURCE_TRANSIENT', true],
  ['prefix gif-sandbox-v1\n', 0, 'FFMPEG_RESOURCE_TRANSIENT', true],
  [
    'gif-sandbox-v1\nprivate decoder detail /tmp/input.gif',
    0,
    'MEDIA_DECODE_FAILED',
    false,
  ],
  ['gif-sandbox-v1\n', 1, 'MEDIA_DECODE_FAILED', false],
] as const)(
  'fails closed for marker/exit/stderr violations (%#)',
  async (stderr, exit, code, retryable) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    spawnMock.mockReturnValueOnce(child);
    const result = runDecoder(
      'ffprobe',
      [],
      Buffer.alloc(0),
      1024,
      1000,
      new AbortController().signal,
    );
    child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exit);
    await expect(result).rejects.toMatchObject({
      message: code,
      code,
      retryable,
    });
    await expect(result).rejects.not.toHaveProperty('cause');
  },
);
