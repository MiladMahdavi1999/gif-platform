# B05 — Reviewer queue, decisions, audit and takedown

Task: B05 only. Started from fetched main `1e06a68bacb8b5d782205acdd0844b6e0b1bd0fa`, which merges B04 PR #5; first-parent history also confirms merged B00–B03 PRs #1–#4. Branch: `codex/b05-reviewer-moderation`. All seven Phase 03 references were read; references and governance files are unchanged. No merge or auto-merge is authorized or performed.

## Implementation

- `packages/contracts/src/review.ts`, generated `docs/api/openapi.json`: strict queue/detail/media/decision/removal contracts, bounded pagination/notes/safe integer versions, action-specific reason enums. The reason taxonomy is a Provisional local engineering choice, not a final safety policy.
- `packages/db/src/review.ts`: processed/PENDING queue; coherent reviewer detail with safe preview paths, decisions and audit; non-owner reviewer decisions. Locks active reviewer and role grant plus asset and state rows, invokes existing domain guards, checks exact `row_version`, and persists decision, policy axes, projection and audit in one transaction. Upload, processing and technical delivery axes remain independent.
- Exact replay uses the same actor, action, reason, normalized note, input version, current result version and transactional audit decision ID. Identical retries return the already committed state; conflicting/stale requests return 409. A replay of approval after removal returns 409. No duplicate decision/audit is inserted.
- Approval additionally requires GIF kind, received/processed state, PENDING, READY, v1 rights attestation, both valid latest-generation derivative descriptors, and exact private S3 version HEAD checks of MIME, length, SHA-256 metadata and checksum. Rejection/removal delete even a stale search projection and block authorization in the same transaction. Removal requires current APPROVED and preserves prior approval history.
- `packages/storage/src/review.ts`: derivative-bucket-only version-pinned preview reads; verifies checksum/size before sending bounded bytes. No quarantine GET, source URL, signed GET URL or redirect. HTTP responses use no-store, nosniff and same-origin resource policy. Missing/unverified derivatives return 409; service failures return sanitized 503.
- `apps/api/src/review.ts` and startup wiring: authoritative REVIEWER authorization, existing Origin/CSRF/session controls, strict variant allowlist, safe typed errors. ADMIN alone does not imply REVIEWER. Dual-role uploaders cannot review their own assets.
- `apps/web/proxy.ts` and `/review`: preserve B02 HTTP 401/403/503 protection; real queue/detail, static poster and explicitly requested GIF playback, approve/reject/remove, explicit reload on conflict, loading/error/retry and history. Asset ID lookup supports takedown of already approved content. Private routes are noindex.
- Migration `0004_moderation_history.sql`: makes decisions append-only against UPDATE/DELETE/TRUNCATE, like existing audit events. Existing migrations are unchanged; development rollback and migration regression expectations include the new migration. No additional core table or collapsed publication flag.
- New real PostgreSQL/MinIO/FFmpeg integration tests and Chromium browser flows; CI runs B00–B05 together. Public gallery/search/media delivery endpoints and Picker remain absent.

## Commands and evidence

Local tool setup uses Node v24.19.0 and pnpm 10.34.7, installed in ignored `work/` because the executor's default pnpm is 11.25.0. For all commands below, local PATH is prefixed with `/workspace/gif-platform/work/bin`. Network-dependent commands run with the executor's network permission enabled; the default sandbox prevents socket access.

Executed successfully:

```sh
npm_config_cache=/workspace/gif-platform/work/npm-cache npm exec --yes --package=pnpm@10.34.7 -- pnpm install --frozen-lockfile --store-dir /workspace/gif-platform/work/pnpm-store
pnpm install --store-dir /workspace/gif-platform/work/pnpm-store
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm api:generate
pnpm api:check
pnpm db:check
pnpm db:generate
```

Observed: all 76 unit tests pass; all package/app typechecks, format, lint, build and OpenAPI checks pass. Schema generation reports no changes. After additive migration/reset expectations were corrected, all 29 B00–B04 PostgreSQL regression tests pass:

```sh
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts
```

Full integration, browser, runtime and CI verification is in progress; no unexecuted test is claimed passed. Final results and CI URLs will be recorded before handover.

Initial local obstacles, with outcomes:

- Default sandbox `git fetch origin main` could not connect to proxy. Repeated with network permission: succeeded and fetched latest main. GitHub connector confirms PR #5 is merged.
- Default pnpm 11.25.0 rejected engine constraint. Used exact pnpm 10.34.7 from ignored `work/`.
- Default sandbox unit tests could not bind loopback. With network permission: 76/76 pass.
- Docker buildx attempted read-only home cache. Set `BUILDX_CONFIG=/workspace/gif-platform/work/buildx`, preserving Docker configuration and credentials.
- Playwright default browser install could not create read-only home cache. System Chromium `/usr/bin/chromium` is available for the local browser run; CI installs the pinned Playwright browser.

## Security, concurrency and acceptance evidence

New integration assertions cover actual processed derivative preview bytes, no source paths in DTOs, anonymous/uploader denials for all operations and both previews, variant tampering, wrong Origin/CSRF, self-review and role revocation, missing processing/readiness/rights/derivatives, malformed reasons/versions, stale expectedVersion, simultaneous competing reviewers, concurrent identical replay, sequential replay, altered reason/note/actor conflicts, approval/rejection/removal atomicity with an injected audit insertion failure, projection deletion, append-only history and prior approval preservation. Exact immutable version overwrite/deletion tests exercise the real object store. These are executable assertions; their final execution result is pending the full-stack gate.

Browser flows upload original owned pixels, await real processing, inspect poster/GIF, approve, reload, remove, inspect history, reject with reason, observe a real stale decision conflict, and recover from a queue failure. Anonymous/uploader review and preview access is denied. Traces/video are disabled for authenticated flows to avoid capturing secrets.

## Known gaps and scope

- Final local full-stack/CI evidence is pending. The initial local executor had no images; MinIO and pinned worker images are being built with the configured proxy CA.
- Rights attestation is an uploader assertion, not legal clearance. Reason codes and safety limits remain Provisional.
- S3 is outside the SQL transaction: exact-version HEAD checks verify approval prerequisites but cannot guarantee perpetual object availability after commit. Preview reads reverify bytes; future B06 must enforce every independent policy gate and handle technical degradation.
- This local slice inherits API/bootstrap identity and production provisioning limitations from B00–B04. Audit/decision triggers do not defend against a privileged database administrator altering schema. No retention/appeals/CDN purge feature is added.
- Public eligibility is proved through transactional states/projection and continued absence of public routes. No claim is made about a future public origin or previously downloaded bytes.

Next unstarted task: **B06 NOT STARTED**. No B07 Picker or later task is implemented.
