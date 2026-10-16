# B05 — Reviewer queue, decisions, audit and takedown

Task: B05 only. Started from fetched main `1e06a68bacb8b5d782205acdd0844b6e0b1bd0fa`, which merges B04 PR #5; first-parent history also confirms merged B00–B03 PRs #1–#4. Branch: `codex/b05-reviewer-moderation`. All seven Phase 03 references were read; references and governance files are unchanged. No merge or auto-merge is authorized or performed.

## Implementation

- `packages/contracts/src/review.ts`, generated `docs/api/openapi.json`: strict queue/detail/media/decision/removal contracts, bounded pagination/notes/safe integer versions, action-specific reason enums. The reason taxonomy is a Provisional local engineering choice, not a final safety policy.
- `packages/db/src/review.ts`: processed/PENDING queue; coherent reviewer detail with safe preview paths, decisions and audit; non-owner reviewer decisions. Locks active reviewer and role grant plus asset and state rows, invokes existing domain guards, checks exact `row_version`, and persists decision, policy axes, projection and audit in one transaction. Upload, processing and technical delivery axes remain independent.
- Exact replay uses the same actor, action, reason, normalized note, input version, current result version and transactional audit decision ID. Identical retries return the already committed state; conflicting/stale requests return 409. A replay of approval after removal returns 409. No duplicate decision/audit is inserted.
- Approval additionally requires GIF kind, received/processed state, PENDING, READY, v1 rights attestation, both valid latest-generation derivative descriptors, and exact private S3 version HEAD checks of MIME, length, SHA-256 metadata and checksum. Rejection/removal delete even a stale search projection and block authorization in the same transaction. Removal requires current APPROVED and preserves prior approval history.
- `packages/storage/src/review.ts`: derivative-bucket-only version-pinned preview reads; verifies checksum/size before sending bounded bytes. Uses `MAX_GIF_OUTPUT_BYTES` independently of the upload budget, because re-encoding may enlarge tiny inputs. Cancels stalled response bodies as well as requests. No quarantine GET, source URL, signed GET URL or redirect. HTTP responses use no-store, nosniff and same-origin resource policy. Missing/unverified derivatives return 409; service failures return sanitized 503.
- `apps/api/src/review.ts` and startup wiring: authoritative REVIEWER authorization, existing Origin/CSRF/session controls, strict variant allowlist, safe typed errors. ADMIN alone does not imply REVIEWER. Dual-role uploaders cannot review their own assets.
- `apps/web/proxy.ts` and `/review`: preserve B02 HTTP 401/403/503 protection; real queue/detail, static poster and explicitly requested GIF playback, approve/reject/remove, explicit reload on conflict, loading/error/retry and history. Asset ID lookup supports takedown of already approved content. Private routes are noindex and deny framing. The reason selector has an explicit accessible label.
- Owner receipts now show persisted APPROVED/REJECTED/REMOVED outcomes instead of continuing to describe terminal reviews as pending. Existing B04 processing and PENDING messages are preserved.
- Migration `0004_moderation_history.sql`: makes decisions append-only against UPDATE/DELETE/TRUNCATE, like existing audit events. Existing migrations are unchanged; development rollback and migration regression expectations include the new migration. No additional core table or collapsed publication flag.
- New real PostgreSQL/MinIO/FFmpeg integration tests and Chromium browser flows; CI runs B00–B05 together. Public gallery/search/media delivery endpoints and Picker remain absent.
- `scripts/test-review-log-hygiene.mjs`: exercises actual private previews, approval/replay/removal and history, then checks real Compose logs for reviewer sessions, CSRF, notes and credentials. Existing B00–B04 runtime checks remain enabled.

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

Observed: all 77 unit tests pass, including cancellation of an HTTP response body that stalls after valid S3 headers; all package/app typechecks, format, lint, build and OpenAPI checks pass. Schema generation reports no changes. After additive migration/reset expectations were corrected, all 29 B00–B04 PostgreSQL regression tests pass:

```sh
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts
```

Verified implementation head: `db36771bd159453ce6eab88cb2d87acb2a73f6e3`. Both jobs passed in [complete CI run 38952453079](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38952453079). [Retained CI excerpts](B05-ci-evidence.txt) contain actual result lines; [browser/runtime artifacts](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38952453079/artifacts/12068004933) contain screenshots and checked runtime logs. [PR #6](https://github.com/MiladMahdavi1999/gif-platform/pull/6) contains the complete changed-file list. The delivery follow-up records documentation/evidence only; its CI is visible on the PR.

| Exact command/check                                                  | Local result                                                         | Real full-stack CI result                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                     | PASS using pinned pnpm (setup above)                                 | PASS                                                                                 |
| `pnpm format:check`                                                  | PASS                                                                 | PASS                                                                                 |
| `pnpm lint`                                                          | PASS                                                                 | PASS                                                                                 |
| `pnpm typecheck`                                                     | PASS                                                                 | PASS                                                                                 |
| `pnpm build`                                                         | PASS, all apps/packages                                              | PASS                                                                                 |
| `pnpm test`                                                          | PASS, 77 tests                                                       | PASS, 77 tests                                                                       |
| `pnpm api:check`                                                     | PASS, OpenAPI matches                                                | PASS                                                                                 |
| `pnpm db:check`; `pnpm db:generate`                                  | PASS, no schema drift                                                | PASS; committed migrations unchanged by generation                                   |
| `pnpm test:integration` with explicit DB/storage opt-ins             | BLOCKED, MinIO unavailable; see attempt below                        | PASS, 62 tests, no skips: 48 B00–B04 regressions + 14 B05 tests                      |
| PostgreSQL-only integration command above                            | PASS, 29 tests                                                       | PASS, separate `b01-database` job                                                    |
| `pnpm exec playwright install --with-deps chromium`; `pnpm test:e2e` | Full stack unavailable; system Chromium used for attempted local run | PASS, all 15 Chromium tests, no skips                                                |
| `pnpm dev`; `pnpm test:smoke`                                        | MinIO build/edge unavailable                                         | PASS, all six real services healthy                                                  |
| `pnpm db:migrate`; `pnpm db:seed:dev`; `pnpm db:inspect:dev`         | Exercised through PostgreSQL integration                             | PASS, repeated migration/seed replay and final inspection                            |
| `pnpm db:reset --confirm=gif_platform` then migrate/seed/inspect     | PASS in PostgreSQL reset regression                                  | PASS; explicit disposable development target only                                    |
| `node scripts/test-auth-log-hygiene.mjs`                             | NOT RUN without full stack                                           | PASS                                                                                 |
| `node scripts/test-upload-log-hygiene.mjs`                           | NOT RUN without full stack                                           | PASS, actual upload/processing logs checked                                          |
| `node scripts/test-review-log-hygiene.mjs`                           | NOT RUN without full stack                                           | PASS, real preview/approval/replay/removal/history and log scan                      |
| `node scripts/test-dependency-failures.mjs`                          | NOT RUN without full stack                                           | PASS, DB/MinIO/API stop/restore with browser health and truthful failure status      |
| `node scripts/test-local-lifecycle.mjs --confirm=gif_platform`       | NOT RUN without full stack                                           | PASS, graceful worker SIGTERM, log scan, fresh volumes and all six services rebooted |

CI storage test environment was exactly the `TEST_DATABASE_URL`, `ALLOW_DATABASE_INTEGRATION_TESTS`, `ALLOW_STORAGE_INTEGRATION_TESTS` and `TEST_S3_*` values in the blocked local attempt below. Browser/runtime steps load ignored `.env` copied from the repository's explicitly local `.env.example`. No production target or third-party media is involved.

Resolved verification failures: an early CI run reached the B03 per-owner upload limit in two B05 fixture setups (60/62 tests passed); fixtures now use two independent uploaders, preserving the production guard. Browser runs exposed an implicit select label containing option text; the UI now has an explicit `Reason` label. A subsequent assertion matched Next.js's hidden route announcer as well as the application alert; assertions now scope to `main`. Both complete browser flows and all integration tests pass in the retained successful run. No failed or blocked attempt is counted as a pass.

Initial local obstacles, with outcomes:

- Default sandbox `git fetch origin main` could not connect to proxy. Repeated with network permission: succeeded and fetched latest main. GitHub connector confirms PR #5 is merged.
- Default pnpm 11.25.0 rejected engine constraint. Used exact pnpm 10.34.7 from ignored `work/`.
- Default sandbox unit tests could not bind loopback. With network permission: 77/77 pass.
- Docker buildx attempted read-only home cache. Set `BUILDX_CONFIG=/workspace/gif-platform/work/buildx`, preserving Docker configuration and credentials.
- Playwright default browser install could not create read-only home cache. System Chromium `/usr/bin/chromium` is available for the local browser run; CI installs the pinned Playwright browser.
- Local pinned MinIO build failed because the network policy denied Go module archive downloads from `storage.googleapis.com`. A CI-built runtime artifact was successfully located/downloaded by the GitHub connector, but transfer into this executor returned HTTP 403. No network policy bypass, TLS weakening or project runtime replacement was used. App and pinned FFmpeg worker image builds did succeed.

Exact blocked local full-stack attempts (these are **not passes**):

```sh
BUILDX_CONFIG=/workspace/gif-platform/work/buildx docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t gif-platform-minio:2025-10-15 -f infra/minio/Dockerfile .
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true ALLOW_STORAGE_INTEGRATION_TESTS=true TEST_S3_ACCESS_KEY_ID=local_access_key TEST_S3_SECRET_ACCESS_KEY=local_only_storage_password TEST_S3_INTERNAL_ENDPOINT=http://127.0.0.1:9000 TEST_S3_PUBLIC_ENDPOINT=http://localhost:9000 pnpm test:integration
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e
pnpm test:smoke
```

Observed locally: MinIO build exits 1 with forbidden dependency archives; full integration reports 29 passed and 33 blocked/skipped after three storage suite setup failures (`ECONNREFUSED :9000`); browser attempt reports 13 failed and 2 not run because no edge was listening (`ERR_CONNECTION_REFUSED :8080`); smoke exits 1 for the same unavailable edge. An alternate diagnostic image pull also failed authorization. These attempts do not establish a product failure or a passing full-stack gate. Full acceptance uses actual CI services, not mocked storage.

A separate temporary browser diagnostic with synthetic HTTP responses reproduced and verified the reason-label fix. It is not counted as real PostgreSQL/MinIO/browser acceptance evidence; the diagnostic servers were stopped.

## Security, concurrency and acceptance evidence

All 14 B05 real integration tests passed. They cover actual processed derivative preview bytes, independent input/output budgets, no source paths in DTOs, anonymous/uploader denials for all operations and both previews, variant tampering, wrong Origin/CSRF, self-review and role revocation, missing processing/readiness/rights/derivatives, malformed reasons/versions, stale expectedVersion, simultaneous competing reviewers, concurrent identical replay, sequential replay, altered reason/note/actor conflicts, approval/rejection/removal atomicity with an injected audit insertion failure, projection deletion, append-only history and prior approval preservation. Exact immutable version overwrite/deletion tests exercise the real object store.

The real race test submits APPROVE and REJECT concurrently through separate reviewer sessions and PostgreSQL connections: response statuses are exactly one 200 and one 409, with one decision, one audit event and one version increment. Concurrent identical requests may both return 200 while persisting only one decision/audit. Injected audit-insertion failure returns sanitized 503 and leaves states, version, decisions and projection exactly unchanged for all three actions. UPDATE/DELETE/TRUNCATE against both history tables is rejected by real PostgreSQL. Rejection/removal each leave zero search projections and INELIGIBLE/BLOCKED/NOT_INDEXED authorization; technical SUCCEEDED/READY is preserved.

Browser flows upload original owned pixels, await real processing, inspect poster/GIF, approve, reload, remove, inspect history, reject with reason, observe a real stale decision conflict, and recover from a queue failure. Anonymous/uploader review and preview access is denied. Traces/video are disabled for authenticated flows to avoid capturing secrets.

Observed browser steps at `http://localhost:8080` in real CI: sign in as uploader → privately upload owned animation → wait for SUCCEEDED → uploader `/review`/preview 403 and anonymous 401 → distinct reviewer selects the queue item → poster and animated GIF decode → approve → saved APPROVED and takedown available after refresh → open approved asset by ID → remove with RIGHTS_REQUEST → REMOVED, both decision records and both audit events visible. A second flow rejects through the UI with RIGHTS_CONCERN, then uses a separate asset for a real competing decision: stale UI approval shows conflict, disables decisions until reload, and reload shows REJECTED. Queue 503 is displayed as an error and a refresh recovers. These are automated observed Chromium actions; no separate human manual pass is claimed.

## Known gaps and scope

- Local full-stack verification remains unavailable because the pinned MinIO dependency archives are denied by executor network policy. Complete real-service CI is verified above; the local blocked checks remain explicitly recorded.
- Rights attestation is an uploader assertion, not legal clearance. Reason codes and safety limits remain Provisional.
- S3 is outside the SQL transaction: exact-version HEAD checks verify approval prerequisites but cannot guarantee perpetual object availability after commit. Preview reads reverify bytes; future B06 must enforce every independent policy gate and handle technical degradation.
- This local slice inherits API/bootstrap identity and production provisioning limitations from B00–B04. Audit/decision triggers do not defend against a privileged database administrator altering schema. No retention/appeals/CDN purge feature is added.
- Public eligibility is proved through transactional states/projection and continued absence of public routes. No claim is made about a future public origin or previously downloaded bytes.

Next unstarted task: **B06 NOT STARTED**. No B07 Picker or later task is implemented.
