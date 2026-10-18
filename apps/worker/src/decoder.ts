import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { WorkerConfig } from '@gif/config';
import { ProcessingFault } from '@gif/contracts';
const sandbox = fileURLToPath(
  new URL('../../../infra/decoder/sandbox.so', import.meta.url),
);
const marker = Buffer.from('gif-sandbox-v1\n');
export type DecoderStage =
  | 'input_validation'
  | 'source_probe'
  | 'display_render'
  | 'display_probe'
  | 'display_compare'
  | 'poster_render'
  | 'poster_probe'
  | 'poster_compare';
// Only controlled stage/code values cross the decoder boundary. No stderr,
// command arguments, input bytes, file names or Error.cause are retained.
export class DecoderFault extends ProcessingFault {
  constructor(
    fault: ProcessingFault,
    public readonly stage: DecoderStage,
  ) {
    super(fault.code, fault.retryable);
  }
}
export async function runDecoder(
  binary: 'ffmpeg' | 'ffprobe',
  args: string[],
  input: Buffer,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(`/usr/bin/${binary}`, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin',
        LANG: 'C',
        LD_PRELOAD: sandbox,
        OMP_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
      },
    });
    let outputSize = 0,
      errorSize = 0;
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let fault: ProcessingFault | undefined;
    const stop = (value: ProcessingFault) => {
      fault ??= value;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new ProcessingFault('MEDIA_TIMEOUT'));
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (data: Buffer) => {
      outputSize += data.length;
      if (outputSize > maxBytes)
        stop(new ProcessingFault('MEDIA_OUTPUT_TOO_LARGE'));
      else output.push(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      errorSize += data.length;
      if (errorSize > 16384) stop(new ProcessingFault('MEDIA_DECODE_FAILED'));
      else errors.push(data);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', () => {
      fault = new ProcessingFault('FFMPEG_RESOURCE_TRANSIENT', true);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const stderr = Buffer.concat(errors);
      if (!stderr.subarray(0, marker.length).equals(marker))
        fault ??= new ProcessingFault('FFMPEG_RESOURCE_TRANSIENT', true);
      if (fault) reject(fault);
      else if (code !== 0 || stderr.length !== marker.length)
        reject(new ProcessingFault('MEDIA_DECODE_FAILED'));
      else resolve(Buffer.concat(output));
    });
  });
}
interface Metadata {
  width: number;
  height: number;
  frameCount: number;
  durationMs: number | null;
}
async function probe(
  bytes: Buffer,
  format: 'gif' | 'png_pipe',
  config: WorkerConfig,
  signal: AbortSignal,
): Promise<Metadata> {
  let out: Buffer;
  try {
    out = await runDecoder(
      'ffprobe',
      [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-threads',
        '1',
        '-protocol_whitelist',
        'pipe',
        '-f',
        format,
        '-i',
        'pipe:0',
        '-show_frames',
        '-show_streams',
        '-show_entries',
        'frame=width,height,pkt_duration_time,duration_time:stream=codec_name,codec_type',
        '-of',
        'json',
      ],
      bytes,
      Math.min(1048576, 2048 + (config.MAX_GIF_FRAMES + 2) * 256),
      config.MEDIA_EXECUTION_TIMEOUT_MS,
      signal,
    );
  } catch (error) {
    if (
      error instanceof ProcessingFault &&
      error.code === 'MEDIA_OUTPUT_TOO_LARGE'
    )
      throw new ProcessingFault('MEDIA_FRAMES_EXCEEDED');
    throw error;
  }
  let value;
  try {
    value = JSON.parse(out.toString('utf8'));
  } catch {
    throw new ProcessingFault('MEDIA_INVALID');
  }
  const frames = value.frames as {
    width: number;
    height: number;
    pkt_duration_time?: string;
    duration_time?: string;
  }[];
  if (
    !Array.isArray(frames) ||
    !frames.length ||
    !Array.isArray(value.streams) ||
    value.streams.length !== 1 ||
    value.streams[0].codec_type !== 'video' ||
    value.streams[0].codec_name !== (format === 'gif' ? 'gif' : 'png')
  )
    throw new ProcessingFault('MEDIA_INVALID');
  if (frames.length > config.MAX_GIF_FRAMES)
    throw new ProcessingFault('MEDIA_FRAMES_EXCEEDED');
  const first = frames[0]!;
  let duration = 0;
  for (const f of frames) {
    dimensions(f.width, f.height, config);
    if (f.width !== first.width || f.height !== first.height)
      throw new ProcessingFault('MEDIA_INVALID');
    if (format === 'gif') {
      const seconds = Number(f.pkt_duration_time ?? f.duration_time);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new ProcessingFault('MEDIA_INVALID');
      duration += seconds;
    }
  }
  if (duration > config.MAX_GIF_DURATION_SECONDS + 0.000001)
    throw new ProcessingFault('MEDIA_TOO_LONG');
  return {
    width: first.width,
    height: first.height,
    frameCount: frames.length,
    durationMs: format === 'gif' ? Math.round(duration * 1000) : null,
  };
}
function dimensions(w: number, h: number, c: WorkerConfig) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1)
    throw new ProcessingFault('MEDIA_INVALID');
  if (
    w > c.MAX_GIF_DIMENSION ||
    h > c.MAX_GIF_DIMENSION ||
    w * h > c.MAX_GIF_PIXELS
  )
    throw new ProcessingFault('MEDIA_DIMENSIONS_EXCEEDED');
}
export async function renderGif(
  path: string,
  config: WorkerConfig,
  signal: AbortSignal,
) {
  let stage: DecoderStage = 'input_validation';
  try {
    const input = await readFile(path);
    if (input.length > config.MAX_GIF_UPLOAD_BYTES)
      throw new ProcessingFault('MEDIA_TOO_LARGE');
    if (
      input.length < 14 ||
      !['GIF87a', 'GIF89a'].includes(input.subarray(0, 6).toString('ascii')) ||
      input.at(-1) !== 0x3b
    )
      throw new ProcessingFault('MEDIA_INVALID');
    dimensions(input.readUInt16LE(6), input.readUInt16LE(8), config);
    stage = 'source_probe';
    const source = await probe(input, 'gif', config, signal);
    if (source.frameCount < 2) throw new ProcessingFault('MEDIA_NOT_ANIMATED');
    const common = [
      '-nostdin',
      '-v',
      'error',
      '-xerror',
      '-max_alloc',
      '67108864',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-filter_complex_threads',
      '1',
      '-protocol_whitelist',
      'pipe',
    ];
    stage = 'display_render';
    const display = await runDecoder(
      'ffmpeg',
      [
        ...common,
        '-f',
        'gif',
        '-i',
        'pipe:0',
        '-filter_complex',
        '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse[v]',
        '-map',
        '[v]',
        '-map_metadata',
        '-1',
        '-an',
        '-threads',
        '1',
        '-fps_mode',
        'passthrough',
        '-loop',
        '0',
        '-f',
        'gif',
        'pipe:1',
      ],
      input,
      config.MAX_GIF_OUTPUT_BYTES,
      config.MEDIA_EXECUTION_TIMEOUT_MS,
      signal,
    );
    stage = 'display_probe';
    const displayMeta = await probe(display, 'gif', config, signal);
    stage = 'display_compare';
    if (
      displayMeta.frameCount !== source.frameCount ||
      displayMeta.width !== source.width ||
      displayMeta.height !== source.height ||
      displayMeta.durationMs !== source.durationMs
    )
      throw new ProcessingFault('MEDIA_DECODE_FAILED');
    stage = 'poster_render';
    const poster = await runDecoder(
      'ffmpeg',
      [
        ...common,
        '-f',
        'gif',
        '-i',
        'pipe:0',
        '-map',
        '0:v:0',
        '-map_metadata',
        '-1',
        '-an',
        '-frames:v',
        '1',
        '-threads',
        '1',
        '-c:v',
        'png',
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      display,
      config.MAX_GIF_OUTPUT_BYTES,
      config.MEDIA_EXECUTION_TIMEOUT_MS,
      signal,
    );
    stage = 'poster_probe';
    const posterMeta = await probe(poster, 'png_pipe', config, signal);
    stage = 'poster_compare';
    if (
      posterMeta.frameCount !== 1 ||
      posterMeta.width !== source.width ||
      posterMeta.height !== source.height
    )
      throw new ProcessingFault('MEDIA_DECODE_FAILED');
    return Promise.all(
      (
        [
          {
            name: 'DISPLAY_GIF',
            bytes: display,
            mimeType: 'image/gif',
            ...displayMeta,
          },
          {
            name: 'POSTER_PNG',
            bytes: poster,
            mimeType: 'image/png',
            ...posterMeta,
          },
        ] as const
      ).map(async (v) => {
        await writeFile(`${path}.${v.name}`, v.bytes, {
          flag: 'wx',
          mode: 0o600,
        });
        return {
          ...v,
          sha256: createHash('sha256').update(v.bytes).digest('hex'),
        };
      }),
    );
  } catch (error) {
    if (error instanceof ProcessingFault) throw new DecoderFault(error, stage);
    throw error;
  }
}
