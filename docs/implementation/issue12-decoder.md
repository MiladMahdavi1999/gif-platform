# Issue #12: large GIFs on inherited pipes

The failure reproduces in **source probing**, before display rendering or moderation, on Linux x86_64 with the pinned FFmpeg 5.1.9. ARM64 is not required to trigger it. The generated representative GIF is 165×293, 93 frames, 100 ms per frame (9.3 s), 3,387,378 bytes. It contains original checkerboard pixels, no external media. The user's `sheen.gif` was not available and was not used.

## Root cause and evidence

FFmpeg 5.1.9's [`gif_read_header`](https://github.com/FFmpeg/FFmpeg/blob/n5.1.9/libavformat/gifdec.c) scans all image blocks to calculate duration/frame count, then calls `avio_seek(pb, 0, SEEK_SET)`. The `pipe` protocol cannot seek. Tiny GIFs work because the initial bytes remain in AVIO's buffer; a larger GIF exhausts that seek-back window and the demuxer returns `AVERROR(EIO)`.

A Node `spawn` reproduction used the worker's minimal environment, `stdio: ['pipe', 'pipe', 'pipe']`, complete input buffer, exact probe arguments, forced demuxer and pipe-only protocol whitelist. In the Bookworm 5.1.9 container:

- The original 85-byte, 1×1 fixture passes every render/probe step.
- The representative GIF fails at source probe: exit 1, sandbox marker followed by `pipe:0: Input/output error`, stdout `{}`. No rendering occurs.
- Removing `LD_PRELOAD` **only for the investigation control** produces the same pipe failure. The sandbox is not the cause.
- A descendant `strace` shows successful reads of the input followed by the EIO diagnostic. There is no failing open, clone, network or memory syscall after the sandbox marker causing the failure. The rewind fails within FFmpeg's AVIO implementation, without a kernel `lseek` on the pipe.
- The same production decoder and representative bytes pass every step with FFmpeg 7.1.5.

The manual shell test in the issue also uses `pipe:0`; running a successful unsandboxed **filename** decode does not control for that non-seekable input. Node's inherited pipe endpoints can differ from shell descriptors, but both encounter this demuxer limitation. Merely removing the sandbox would not fix it.

Seccomp inspection found the architecture checks support x86_64/aarch64. The `clone` branch skips its four-instruction argument/return block for other syscalls, permits thread clones, and rejects process clones; `clone3` returns `ENOSYS` for the existing fallback. No filter changes or increased budgets are needed.

## Fix

Only the worker moves to digest-pinned Node 24.19.0 Trixie with Debian FFmpeg `7:7.1.5-0+deb13u1`. API/web keep their existing Bookworm base. FFmpeg 7.1.5's GIF demuxer skips the full-header scan for non-seekable input and retains only the small necessary header for rewind. This uses a maintained distribution package instead of a private codec patch or temporary-file protocol.

`LD_PRELOAD`, seccomp, resource limits, thread settings, pipe-only protocol whitelist, required marker, strict stderr/exit checks, byte/time limits, full-frame probing, metadata comparisons, private derivatives and moderation transitions remain enforced. There is no fallback decoder. Controlled diagnostic stages are attached to typed faults and logged with the existing job identifiers and safe code; raw stderr, arguments, paths, source bytes and error causes are never logged or persisted. Existing persisted error codes remain compatible.

## Reproduce and validate

On Linux, use the repository's pinned pnpm and Node versions:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm build:decoder
pnpm --filter @gif/worker build
node scripts/reproduce-decoder.mjs
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

The reproduction calls `renderGif` directly, so it uses the exact production spawn environment, inherited pipes, marker and output validation. It prints only generated variant metadata on success, or a controlled stage/code on failure. With 5.1.9 it exits 1 at `source_probe` with `MEDIA_DECODE_FAILED`; with 7.1.5 it returns DISPLAY_GIF 165×293/93 frames/9300 ms and POSTER_PNG 165×293/1 frame.

For the actual worker image (supply the repository's normal proxy CA build secret when required):

```sh
docker build --target worker -f infra/docker/Dockerfile -t gif-platform-worker:issue12 .
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 1536m --cpus 1 --pids-limit 64 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=100m \
  --entrypoint node gif-platform-worker:issue12 scripts/reproduce-decoder.mjs
```

The regression suite covers the larger valid animation, existing malformed/truncated/still/wrong bytes, dimensions/pixels/frames/duration/input/output/time budgets, OS file/network/process denial, hard memory/CPU/fd/core budgets, and marker/exit/stderr fail-closed behavior. The processing integration success case now uses this larger GIF and verifies real object versions/checksums, `SUCCEEDED`, `PENDING` moderation, private visibility, no search/public delivery, and atomic completion.

`.github/workflows/decoder.yaml` runs the decoder suite on native `ubuntu-24.04` and `ubuntu-24.04-arm` runners in the pinned Trixie/FFmpeg container. The local host is x86_64; native ARM64 validation uses that CI job rather than emulation.

## Recorded validation

- `pnpm test`: 110/110 tests passed locally; `pnpm typecheck`, `pnpm lint`, Prettier and regression-gate checks passed.
- FFmpeg 5.1.9: exact Node pipe probe fails with and without the sandbox. FFmpeg 7.1.5: full pipeline succeeds under the sandbox.
- Actual worker image build passed. The production decoder and reproduction helper passed with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 1536m --cpus 1 --pids-limit 64` and the 100 MiB temporary filesystem. DISPLAY_GIF is 51,312 bytes, POSTER_PNG is 1,172 bytes; metadata matches all 93 source frames.
- [Native ARM64 and x86_64 decoder CI](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39161643597): both jobs passed all 12 tests on commit `d275cfb` (including sandbox OS denial/resource probes).
