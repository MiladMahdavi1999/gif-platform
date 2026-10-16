# B04 — Durable lease worker and safe animation processing

Status: implemented and verified on code commit `46e9fd7`; local execution limitation for full MinIO/browser stack remains explicitly recorded. B05 NOT STARTED.

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
- `pnpm test`: passed (real Linux FFmpeg 7.1.5/ffprobe, original authored byte fixtures, sandbox probe); **75 tests passed**, none skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm api:check`, `pnpm db:check`, `pnpm db:generate`: executed successfully; schema generation reports no drift. `pnpm format:check` also passed.
- `BUILDX_CONFIG=/workspace/gif-platform/work/buildx docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" --target worker -f infra/docker/Dockerfile -t gif-platform-worker:b04 .`: passed locally on final processing code.
- `docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 1536m --cpus 1 --pids-limit 64 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=100m --mount type=bind,src=/workspace/gif-platform/docs/implementation/B04-decoder-proof.mjs,dst=/app/decoder-proof.mjs,readonly --entrypoint node gif-platform-worker:b04 decoder-proof.mjs`: passed locally with pinned FFmpeg 5.1.9. The retained probe script uses original authored pixels and no external data or services. DISPLAY_GIF: 1×1, 2 frames, 200ms, 863 bytes, SHA-256 `5cfd62ded9c90c54bbc9c91b6ff54ac2ffea784218b31026682bc98d32ab51aa`. POSTER_PNG: 1×1, 1 frame, 91 bytes, SHA-256 `e2ea78282c85adf7b93826760e2d210e799fbc66632f084ea49a68d8390d2e26`.
- `docker compose -f infra/compose.db-test.yaml up -d --wait`: passed with PostgreSQL 17.6.
- `TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts`: **29 passed**, none skipped (23 B01/B02 regressions and six B04 real PostgreSQL lease/security tests). Tests prove concurrent claim exclusion, lease heartbeat/expiry, stale completion rejection, bounded retries, crashed final-attempt reaping, transactional rollback and restricted role denials. Repository-only transaction tests use metadata descriptors, not claimed S3 verification.

Initial test failures (duration field compatibility, per-UID task budget, fixture SQL parameter inference and historical migration-count expectations) were corrected and rerun. The first CI integration suite passed 47 tests but its browser suite finished 12/13 because the error test matched Next’s route announcer as well as the receipt alert; the locator is now scoped to main. A subsequent TypeScript union inference error in storage-denial tests was corrected and local typecheck/unit gates rerun. Failed executions are not represented as passes.

## CI-only gates and evidence

Full GitHub Actions run [38908695929](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38908695929) **passed both jobs** on `46e9fd77f923b9b27334912c6e1245e0a7ad0e3f`: 75 unit tests, 48 full real PostgreSQL/MinIO/FFmpeg integration tests and 13 Chromium browser tests, with no skipped tests. The separate database job also passed all 29 PostgreSQL tests. Frozen install, format/lint/typecheck/build, OpenAPI/schema drift, private worker identity provisioning, migrate/seed/reset replay, health smoke, credential/log checks, DB/MinIO/API outages/recovery, worker SIGTERM and fresh-volume reboot all passed.

- [Full-stack job](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38908695929/job/116998732460).
- [Database job](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38908695929/job/116998731932).
- [Browser/runtime evidence artifact](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38908695929/artifacts/12049821536): `b04-pending.png`, `b04-success-private.png`, `b04-error-private.png`, B00–B03 screenshots and checked runtime logs. Auth traces/video remain disabled to avoid credential retention.
- Retained selected result lines: [B04-ci-evidence.txt](B04-ci-evidence.txt).

Exact full-stack commands executed by CI (the workflow defines their order and environment):

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
sudo apt-get update && sudo apt-get install -y ffmpeg gcc
pnpm test
pnpm api:check
pnpm build
cp .env.example .env
pnpm dev
pnpm db:migrate
pnpm db:seed:dev
pnpm db:inspect:dev
pnpm db:reset --confirm=gif_platform
pnpm test:smoke
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true ALLOW_STORAGE_INTEGRATION_TESTS=true TEST_S3_ACCESS_KEY_ID=local_access_key TEST_S3_SECRET_ACCESS_KEY=local_only_storage_password TEST_S3_INTERNAL_ENDPOINT=http://127.0.0.1:9000 TEST_S3_PUBLIC_ENDPOINT=http://localhost:9000 pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
node scripts/test-auth-log-hygiene.mjs
node scripts/test-upload-log-hygiene.mjs
node scripts/test-dependency-failures.mjs
node scripts/test-local-lifecycle.mjs --confirm=gif_platform
docker compose --env-file .env -f infra/compose.yaml down
```

Migration/seed replay and post-reset/reboot remigration/reseed/inspection are repeated in the workflow. The database-only job executes `pnpm db:check`, `pnpm db:generate` with a clean migration diff, and the local PostgreSQL command above (using its isolated CI PostgreSQL service). The initial failed CI runs are retained as failure history; no skipped/failing run is called green.

Local MinIO build command `BUILDX_CONFIG=/workspace/gif-platform/work/buildx docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .` failed because the network policy denies a Go dependency redirect to `storage.googleapis.com`. `docker pull quay.io/minio/minio:RELEASE.2025-10-15T17-29-55Z` also failed (registry unauthorized). The real MinIO/browser gates passed on Actions; this is not a local pass. A B03 runtime artifact was located through GitHub but not installed locally.

Full CI includes original B00–B03 suites, B04 two-process claim exclusion, actual SIGKILL after derivative upload/precommit, actual lease expiry/restart, exactly two object versions/two variant rows/one success audit, pinned-input overwrite recovery, actual derivative checksums/HEAD, retry/max attempts, transaction rollback and private/public access denials. Browser tests stop/restart the actual worker and retain pending/success/error screenshots after refresh.

## Validation and transactional guarantees

| Boundary                    | Evidence / typed outcome                                                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real input decoding         | Original red/blue authored GIF succeeds; still GIF gives MEDIA_NOT_ANIMATED, wrong bytes MEDIA_INVALID, corrupt/truncated GIF rejected.                                                                                                                                                                                    |
| Geometry/time/frame budgets | Header plus decoded dimensions/pixels, finite per-frame timing and total duration/frame limits; MEDIA_DIMENSIONS_EXCEEDED, MEDIA_TOO_LONG, MEDIA_FRAMES_EXCEEDED. Independently authored 301-frame and 32-second fixtures exercise default ceilings.                                                                       |
| Execution/output budgets    | Hard OS limits plus process/job cancellation and stdout caps; MEDIA_TIMEOUT / MEDIA_OUTPUT_TOO_LARGE; boundary probe proves file, socket and process creation denial.                                                                                                                                                      |
| Immutable source            | B03 version and ETag are supplied to quarantine GET; replacing latest with invalid bytes still processes the pinned original.                                                                                                                                                                                              |
| Derivatives                 | Both outputs are decoded again; actual frame count/dimensions/duration and SHA-256 are recorded. Stored checksums/size/type and exact version are HEAD verified; anonymous versioned/unversioned reads fail.                                                                                                               |
| Lease/DB boundary           | Two OS workers claim exactly once; an additional final PostgreSQL assertion races two success transactions with the same token and permits only one commit; expiry invalidates heartbeat/completion; crash before DB commit leaves no variants; atomic rollback/recovery gives exactly two variants and one success audit. |
| Retry/security              | Storage and processing infrastructure failures back off; maximum/crashed final attempts terminate. Worker DB and storage identities cannot approve/publish/index/replace source/change bucket policy.                                                                                                                      |

## Provisional choices, known gaps and risks

- Provisional: Linux seccomp plus inherited-pipe IO replaces filename-based FFmpeg examples. No arbitrary filesystem/network access is needed by decoders. Linux x86_64/aarch64 only; sandbox startup failure is closed. Worker FFmpeg is pinned to Debian 5.1.9; host checks additionally exercise 7.1.5 compatibility. Neither substitutes for patch/security maintenance.
- Provisional: 30-second leases (heartbeat every third), 300 frames, 4096 dimensions, 16M pixels, 20 MiB per input/output, 10-second decoder and 60-second job deadlines. These are local safety limits, not product SLAs. Container limits are documented in README.
- Provisional: content-addressed keys include asset/generation/hash and use If-None-Match. Retries preserve exact existing bytes and verify their pinned versions. Private orphan derivatives after a final failure can remain; audited retention/orphan cleanup remains later operational work, not B04 deletion scope.
- Development worker PostgreSQL login provisioning is explicit and local-only. Production provisioning and S3 identities/policies remain operator-owned. Local worker has a separate least-privilege MinIO identity provisioned by a local-only helper built against the existing pinned MinIO dependencies. It can read pinned quarantine objects and read/write the derivative prefix, but cannot replace quarantine, delete outputs, change bucket policy or write elsewhere; decoder children inherit no credentials. Production must provision equivalent scoped storage identities externally.
- Crashed process temporary directories can remain on a host; Compose worker temporary files live on bounded ephemeral tmpfs and disappear when its container is recreated. Normal success/failure always cleans its workspace. No media is served from temporary storage.
- Human review remains mandatory and intentionally unavailable until B05. No production readiness, legal clearance or public exposure is claimed.

B05 NOT STARTED.

## Final review and delivery follow-up

Final review checked lease claim/heartbeat/completion fencing, transaction rollback, pinned source GET and output HEAD/checksum checks, decoder argument/syscall/resource boundaries, least-privilege database/storage grants and owner receipt privacy. No additional B04 acceptance blocker was found. The seven architecture reference documents remain byte-for-byte unchanged from main; B05 is not started.

The delivery follow-up retains verified CI evidence and the reproducible pinned decoder probe, updates this report, and strengthens the PostgreSQL test to race two completion transactions with the same lease token. Exactly one completion commits. The follow-up does not change processing behavior. Final delivery-head workflow results are available through [PR #5 Checks](https://github.com/MiladMahdavi1999/gif-platform/pull/5/checks); the verified processing-code run above remains linked separately so execution evidence is attributable to its exact commit.

## Changed files

```text
.env.example
.github/workflows/ci.yaml
.gitignore
README.md
apps/web/app/studio/assets/receipts.tsx
apps/web/app/studio/upload/upload-form.tsx
apps/worker/package.json
apps/worker/src/decoder.test.ts
apps/worker/src/decoder.ts
apps/worker/src/main.ts
apps/worker/src/process-job.ts
docs/implementation/B04-ci-evidence.txt
docs/implementation/B04-decoder-proof.mjs
docs/implementation/B04-report.md
docs/implementation/known-gaps.md
infra/compose.db-tools.yaml
infra/compose.yaml
infra/decoder/probe.c
infra/decoder/sandbox.c
infra/docker/Dockerfile
infra/minio/Dockerfile
infra/minio/provision-worker.go
package.json
packages/config/src/config.test.ts
packages/config/src/index.ts
packages/contracts/src/index.ts
packages/contracts/src/processing.ts
packages/db/migrations/0003_processing_metadata.sql
packages/db/migrations/meta/0003_snapshot.json
packages/db/migrations/meta/_journal.json
packages/db/rollback/core.sql
packages/db/src/cli.ts
packages/db/src/database.integration.test.ts
packages/db/src/index.ts
packages/db/src/leases.integration.test.ts
packages/db/src/processing.integration.test.ts
packages/db/src/processing.ts
packages/db/src/schema.ts
packages/db/src/worker-access.ts
packages/storage/src/index.ts
packages/storage/src/processing.ts
packages/storage/src/uploads.ts
packages/testing/src/index.ts
pnpm-lock.yaml
scripts/build-decoder.mjs
scripts/test-local-lifecycle.mjs
scripts/test-upload-log-hygiene.mjs
scripts/worker-test-process.mjs
tests/e2e/processing.spec.ts
tests/e2e/uploads.spec.ts
```
