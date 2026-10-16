# B04 — Durable lease worker and safe animation processing

Status: implementation and local checks complete; full CI verification pending. B05 NOT STARTED.

Baseline: latest main `cc3513a8d3fc195b473af5d1a729cca303554693`. GitHub confirms B00 #1 (`eba9ad6`), B01 #2 (`17335ec`), B02 #3 (`7c9dbad`) and B03 #4 (`cc3513a`) merged. All seven Phase 03 references were read; their contents and governance files remain unchanged. Dedicated branch: `codex/b04-durable-lease-worker`.

## Implementation

- `packages/db/src/processing.ts`: atomic SKIP LOCKED claims, bounded attempts, UUID lease tokens, expiry/heartbeat fencing, crash recovery, persisted capped exponential backoff/jitter, conditional transactional success/failure, audit and completed job.
- `packages/storage/src/processing.ts`: private quarantine-only version/ETag-pinned download with byte cap and source hash; private content-addressed immutable conditional derivative writes with SHA-256 checksum, metadata and exact-version HEAD verification. No signing, ACL or public delivery methods.
- `apps/worker/src/decoder.ts`, `infra/decoder/`: real FFprobe decode validation, fixed pipe-only FFmpeg palette re-encode and first-frame PNG; second decode validates output metadata. Linux seccomp boundary denies file opens/network/process execution and inspection, with hard memory/CPU/fd/task/core budgets. Container adds read-only root, capability drop, CPU/memory/task/tmpfs quotas. Decoder environment excludes credentials. Runtime logs contain safe constants only.
- `apps/worker/src/process-job.ts`, `main.ts`: private temporary workspace, total/per-process deadlines, lease heartbeats, abort/cleanup, safe typed error mapping and graceful shutdown. Failure to persist leaves the lease recoverable.
- Migration 0003 adds derivative object version/frame metadata and a fixed PENDING-only review request function. Development seed provisions a separate restricted PostgreSQL login; it cannot approve/publish/index/change upload versions/read sessions or grant roles. Existing migrations and B03 receipt/version/idempotency semantics are preserved.
- Owner receipt polling displays queued, running, retry, success and terminal failure accurately without any original/derivative URL. No approval, moderation decisions, publication, search, delivery or Picker implementation.

## Executed local checks

This executor's default pnpm was 11.25.0; it was rejected by the pinned engine. Installed pnpm 10.34.7 under ignored `work/tools` with `npm install --cache /workspace/gif-platform/work/npm-cache --prefix work/tools pnpm@10.34.7`. Commands below use `export PATH=/workspace/gif-platform/work/tools/node_modules/.bin:$PATH`.

- `pnpm install --frozen-lockfile --store-dir /workspace/gif-platform/work/pnpm-store`: passed.
- `pnpm test`: passed (real Linux FFmpeg 7.1.5/ffprobe, original authored byte fixtures, sandbox probe); final count recorded below after final verification.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm api:check`, `pnpm db:check`, `pnpm db:generate`: executed successfully; schema generation reports no drift. Final format verification pending report update.
- `docker compose -f infra/compose.db-test.yaml up -d --wait`: passed with PostgreSQL 17.6.
- `TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts`: **29 passed**, none skipped (23 B01/B02 regressions and six B04 real PostgreSQL lease/security tests). Tests prove concurrent claim exclusion, lease heartbeat/expiry, stale completion rejection, bounded retries, crashed final-attempt reaping, transactional rollback and restricted role denials. Repository-only transaction tests use metadata descriptors, not claimed S3 verification.

Initial test failures (duration field compatibility, per-UID task budget, fixture SQL parameter inference and historical migration-count expectations) were corrected and rerun. Failed executions are not represented as passes.

## CI-only gates and evidence

Full PostgreSQL + MinIO + FFmpeg processing/crash tests, Compose runtime/browser tests and GitHub Actions are pending. No CI-only test is currently claimed passed.

Local MinIO build command `BUILDX_CONFIG=/workspace/gif-platform/work/buildx docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .` failed because the network policy denies a Go dependency redirect to `storage.googleapis.com`. `docker pull quay.io/minio/minio:RELEASE.2025-10-15T17-29-55Z` also failed (registry unauthorized). The real MinIO/browser gates will run on Actions; this is not a local pass. A B03 runtime artifact was located through GitHub but not installed locally.

Full CI includes original B00–B03 suites, B04 two-process claim exclusion, actual SIGKILL after derivative upload/precommit, actual lease expiry/restart, exactly two object versions/two variant rows/one success audit, pinned-input overwrite recovery, actual derivative checksums/HEAD, retry/max attempts, transaction rollback and private/public access denials. Browser tests stop/restart the actual worker and retain pending/success/error screenshots after refresh.

## Provisional choices, known gaps and risks

- Provisional: Linux seccomp plus inherited-pipe IO replaces filename-based FFmpeg examples. No arbitrary filesystem/network access is needed by decoders. Linux x86_64/aarch64 only; sandbox startup failure is closed. Worker FFmpeg is pinned to Debian 5.1.9; host checks additionally exercise 7.1.5 compatibility. Neither substitutes for patch/security maintenance.
- Provisional: 30-second leases (heartbeat every third), 300 frames, 4096 dimensions, 16M pixels, 20 MiB per input/output, 10-second decoder and 60-second job deadlines. These are local safety limits, not product SLAs. Container limits are documented in README.
- Provisional: content-addressed keys include asset/generation/hash and use If-None-Match. Retries preserve exact existing bytes and verify their pinned versions. Private orphan derivatives after a final failure can remain; audited retention/orphan cleanup remains later operational work, not B04 deletion scope.
- Development worker PostgreSQL login provisioning is explicit and local-only. Production provisioning and S3 identities/policies remain operator-owned. Local worker has a separate least-privilege MinIO identity provisioned by a local-only helper built against the existing pinned MinIO dependencies. It can read pinned quarantine objects and read/write the derivative prefix, but cannot replace quarantine, delete outputs, change bucket policy or write elsewhere; decoder children inherit no credentials. Production must provision equivalent scoped storage identities externally.
- Crashed process temporary directories can remain on a host; Compose worker temporary files live on bounded ephemeral tmpfs and disappear when its container is recreated. Normal success/failure always cleans its workspace. No media is served from temporary storage.
- Human review remains mandatory and intentionally unavailable until B05. No production readiness, legal clearance or public exposure is claimed.

B05 NOT STARTED.
