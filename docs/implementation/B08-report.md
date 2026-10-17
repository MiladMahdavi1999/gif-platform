# B08 — Failure recovery, operations and CI gate hardening

## Scope and baseline

Started from fetched `main` **f4c10ea21762e8d297b479cd937b47f8f802323a**, merged B07 PR [#8](https://github.com/MiladMahdavi1999/gif-platform/pull/8). GitHub merged-PR metadata and main history confirm B00–B06 PRs #1–#7 merged. Dedicated branch: `codex/b08-failure-recovery`. Read all seven root Phase 03 documents and inspected API/worker/PostgreSQL/private storage/decoder/moderation/delivery/Picker/Compose/tests/workflow before implementation.

B08 reuses existing lease/token fencing, conditional content-addressed output writes, pinned source/derivative versions, atomic moderation and append-only history. No architecture redesign, schema migration, product expansion, automatic reapproval, retry reset or merge. **B09 NOT STARTED.**

## Changed files and rationale

| Files                                                                                                                                        | Purpose                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts`, `app.test.ts`                                                                                                         | Server UUID request IDs, safe completion log records, sanitized unmatched-route responses, truthful 503 for unclassified dependency failures; regression for nonreflection.                                                                                             |
| `apps/api/src/public.ts`, `public-limits.ts`, `public-limits.test.ts`, `main.ts`                                                             | Separate bounded search/detail/Picker and media budgets, Retry-After/no-store, bounded concurrent media IO and safe error recovery tests; wire configuration.                                                                                                           |
| `packages/config/src/index.ts`, `config.test.ts`, `.env.example`, `infra/compose.yaml`                                                       | Explicit configurable Provisional public budgets, require production values, preserve existing resource thresholds; clarify worker startup liveness.                                                                                                                    |
| `packages/db/src/processing.ts`, `uploads.ts`, `review.ts`                                                                                   | Add server-side statement/idle-transaction deadlines alongside existing client timers; processing readiness schema probe. No changes to lease transitions or decision semantics.                                                                                        |
| `packages/db/src/operations.ts`, `index.ts`                                                                                                  | Bounded read-only job/degradation diagnostics and conservative all-generation reference lookup with safe code/request-ID projection.                                                                                                                                    |
| `packages/storage/src/uploads.ts`, `processing.ts`, `orphans.ts`, `index.ts`                                                                 | Both private bucket existence/versioning readiness checks with hard deadlines; authenticated worker bucket metadata probes; strictly per-asset detection-only version inventory with hashed identifiers.                                                                |
| `apps/worker/src/main.ts`, `infra/minio/provision-worker.go`                                                                                 | Distinct live/ready files, safe job/asset/attempt correlation, readiness withdrawal/recovery; only additional worker S3 privilege is GetBucketVersioning for the two buckets.                                                                                           |
| `packages/contracts/src/index.ts`, `docs/api/openapi.json`                                                                                   | Document implemented rate/busy/error contracts and regenerate OpenAPI without drift.                                                                                                                                                                                    |
| `scripts/operations.mjs`, `operations-command.mjs`, `package.json`, `infra/docker/Dockerfile`                                                | Explicitly enabled operator shell commands shipped in runtime; no public endpoint, mutation or deletion code.                                                                                                                                                           |
| `packages/db/src/leases.integration.test.ts`, `processing.integration.test.ts`, `public.integration.test.ts`, `auth-api.integration.test.ts` | Real lease expiry/diagnostics; real DB rejection/restoration and MinIO stop/start mid-job; bounded job timeout; exact safe 503; orphan scope/pinning/truncation and versioning health; update dependency error expectation from 500 to 503. Preserve earlier scenarios. |
| `scripts/test-operations.mjs`, `test-dependency-failures.mjs`                                                                                | Actual runtime diagnostic/private access/log hygiene, real public API failure + browser error and worker dependency readiness withdrawal.                                                                                                                               |
| `scripts/check-test-gates.mjs`, `.github/workflows/ci.yaml`                                                                                  | Fail on skipped/todo/exclusive/conditional regression declarations; initialize fresh volumes, run full B00–B08 gates, retain browser/runtime evidence and tear down both fixture projects with volumes.                                                                 |
| `README.md`, `B08-operations.md`, this report                                                                                                | Current troubleshooting, safe recovery, resource budget and orphan-review procedures, commands/results/limitations.                                                                                                                                                     |

## Failure scenarios and acceptance evidence

Existing B04 real-process tests remain mandatory: two OS workers race one claim; an actual worker is SIGKILLed after two S3 uploads before commit; a new OS worker resumes after legitimate persisted expiry with exactly two object versions/two variants/one success audit. Heartbeat/stale-token success/failure fencing, concurrent completion, retry backoff/exhaustion and transaction rollback remain covered. Existing B03 idempotent concurrent/lost-response receipt retry and B05 exact moderation replay/competing decisions/all-action rollback remain covered. B06 real missing/corrupt pinned media tests return safe 503, record technical degradation once and preserve business/moderation history; removal races win the final byte-delivery gate. B07 prevents duplicate selection and false Host action.

New deterministic failure-injection cases:

1. Real PostgreSQL database refuses new connections and terminates target connections after derivative uploads, before success commit. Worker cannot persist failure and leaves a fenced lease; API returns actual **503**, `Public service unavailable. Please retry.`, with no SQL/credential leak. After database restoration and genuine 3-second lease expiry, processing succeeds once, remains private and has exactly two variants.
2. Real Compose MinIO stops after pinned source download during active processing. Output IO fails with persisted safe retry/backoff; after real MinIO restoration and due time, processing succeeds, no variants were partially committed and public access remains denied.
3. A real pinned download followed by a deterministic abort-aware stall hits the configured whole-job deadline, persists terminal `MEDIA_TIMEOUT`, no variants/approval/publication, and diagnostics advise manual investigation. Existing retryable-failure and final-crashed-attempt tests exercise the retry ceiling separately.
4. Real PostgreSQL diagnostics classify waiting/due/expired/terminal/degraded states, use actual lease expiry and scrub unknown failure text; no mutation or sensitive field exposure.
5. Real versioned MinIO inventory protects active job/approved/pinned scope, reports unmatched objects only for manual review, limits listing to 100 entries per bucket with explicit truncation and rejects invalid asset scope. No deletion command exists.
6. Suspending derivative-bucket versioning produces readiness 503 and liveness 200; re-enabling restores readiness. Worker restricted identity can authenticate the bucket-versioning probes.
7. Negative API tests enforce separate public budgets, shared Picker/read retries, untrusted forwarded-IP rejection, bounded peer capacity, active media concurrency and release after failure, Retry-After/no-store, safe 503 and unavailable internal HTTP paths. Existing authentication, upload quota/size, CSRF/Origin and role negative cases remain mandatory.
8. Runtime outage checks assert real public search 503 and safe gallery message during PostgreSQL stop, while liveness stays 200; restoration returns public search 200. Runtime operator checks test denied destructive flags, required opt-in, anonymous denial, UUID correlation and exclusion of credential/query/token/path/key sentinels from logs.

Observed execution results are recorded below; descriptions above are test intent until the corresponding run passes.

## Operations, health and guardrails

See [B08 operations runbook](B08-operations.md) for exact diagnostic/restart commands, action classifications and manual-review limits. `pnpm ops:inspect` is read-only and bounded; `pnpm ops:orphans <uuid>` is always detection-only. Operators require trusted Docker/shell access. No new browser role, Admin UI or retry mutation is introduced; there is no reason to add an unreviewed force-retry path around existing automatic recovery.

API liveness answers whether it runs. Readiness checks PostgreSQL, real MinIO health, authenticated existence and enabled versioning for both private buckets; dependency failure returns 503. Worker startup health remains liveness to allow initial role bootstrap; separate authenticated readiness withdraws its file on dependency failure and refreshes after recovery. Probe freshness does not promise future IO, every asset's integrity or business eligibility.

Login remains 10/account and 50/peer per 15 minutes; upload intent remains database-serialized 20/owner per 15 minutes. Existing 20 MiB upload/output, JSON/SQL/decoder/frame/duration/pixel/container limits remain. New explicit **Provisional local** public budgets: 300 search/detail/Picker reads per socket peer per minute; 600 media reads; at most five concurrent media reads per process (existing public DB pool bound). They require explicit production configuration and human production-capacity/proxy/distributed-limit review, not invented production targets. Per-peer maps are bounded at 10,000 entries each and fail closed. Origin, CSRF, roles and authentication remain enforced.

Server-generated UUIDs correlate API error/header/safe logs; worker job/asset/attempt IDs correlate to receipt audit request IDs. Raw requests/URLs/query strings/errors, secrets, signed policies, private keys/versions, decoder stderr/temp paths, session/CSRF, notes and sensitive account data are excluded from logs/diagnostic output. No technical failure changes a moderation decision.

## S3 orphan safety model

Automatic deletion cannot be proven safe: signed uploads/worker S3 writes and PostgreSQL pinning do not share a writer-fencing transaction, and retries may adopt previously uncommitted content-addressed outputs. B08 therefore implements the explicitly allowed **detection + manual review** alternative. Exact computed asset prefixes in the two configured buckets only, at most 100 version/delete-marker entries per bucket, no pagination/global listing, hard deadlines, all pins/all generations protected, any active/completed upload or any job protects scope, and only hashes leave the operator tool. Truncation and failure are explicit. No destructive flags are accepted, no deletion permissions added, and there is no destructive implementation to confirm. The runbook requires separate explicit confirmation, exact-version inventory, concurrency fencing and approved retention/incident plan before any future manual deletion; without proof retain objects.

## Local commands and observed results

The executor initially had a sandbox proxy/socket/process restriction. Authorized escalated execution made git fetch, dependency installation, Docker/PostgreSQL, local socket unit tests and production build available. No approval rejection occurred. Repository-pinned Corepack pnpm **10.34.7** is used; default global pnpm is 11.25.0 and nested scripts refuse it. A task-local Corepack shim in ignored `work/bin` resolves this without changing pins.

```sh
git fetch origin main
git switch -c codex/b08-failure-recovery origin/main
mkdir -p work/bin
corepack enable --install-directory work/bin
export PATH="$PWD/work/bin:$PATH"
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm api:check
pnpm db:check
pnpm db:generate
git diff --exit-code -- packages/db/migrations
node scripts/check-test-gates.mjs
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts --exclude packages/db/src/public.integration.test.ts
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .
```

- Fetch/branch/frozen install: passed. Build/typecheck/lint/OpenAPI and schema checks passed during implementation; final verification pending the latest source changes.
- `pnpm test`: **103 passed, 14 files**, zero skips after granting local process/socket access. The initial sandbox attempt failed EPERM for existing socket/probe tests; it was not a pass. A real dependency-error expectation was updated to the new truthful 503; PostgreSQL rerun: **30 passed, three files**, zero skips.
- `pnpm db:generate`: no schema changes; existing migration diff empty.
- Full local MinIO build: **BLOCKED**, pinned upstream Go dependency downloads redirect to `storage.googleapis.com` and receive `Forbidden`. No network-policy bypass or dependency substitution. Accordingly full local MinIO/FFmpeg integration, full-stack browser, runtime operational/log/outage and fresh-volume lifecycle checks are **NOT RUN locally**. Their CI result must be recorded before ready-for-review.

## CI links and evidence

Draft PR and full B00–B08 Actions run pending initial push. The workflow runs frozen install, formatting, lint, typecheck/build, unit, OpenAPI/schema drift, real PostgreSQL/MinIO/FFmpeg integration, Chromium E2E, security/privacy, runtime log hygiene, dependency failure/recovery, process crash/restart and fresh-volume initialization/lifecycle/cleanup. No check is claimed passed before execution. The dedicated PostgreSQL job repeats the database-only subset. Artifact name: `b08-browser-runtime-evidence`.

## Manual smoke and remaining limits

Local direct/API/DB checks passed as above; local six-service/browser manual smoke is blocked by MinIO compilation. CI runs the deterministic real worker kill/restore/expiry, dependency stop/restore, safe UI retry, operational commands, actual upload→process→review→search→Picker→remove regressions and fresh boot. Record observed CI outcomes before marking ready.

No architecture mismatch requiring reference edits was found. New public budgets, metadata-probe permission, read-only diagnostics and detection-only cleanup are Provisional implementation choices within the existing architecture; human review is required before production use. There is no automatic repair for terminal jobs or DEGRADED pinned media; those require manual investigation and a future audited, reviewed recovery plan. Process-local public/login limits and shared Caddy/web peer budgets are unsuitable as a distributed quota guarantee. Retention, legal rights, privacy policy, production IAM/bootstrap, backups, capacity and patch maintenance remain inherited unresolved deployment gates. Previously downloaded/cached bytes cannot be recalled. Orphans are retained because deletion cannot be fenced safely.

All seven Phase 03 reference documents, governance files and historical migrations must remain byte-for-byte unchanged relative to the baseline; final verification recorded with delivery evidence. No merge or auto-merge. **B09 NOT STARTED.**
