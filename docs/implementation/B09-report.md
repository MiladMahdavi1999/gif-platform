# B09 — Staging-ready build package, contract audit and release gate

Status: **Draft; verification in progress.** No merge or auto-merge. B09 only; the entire GIF Platform project is not complete.

## Scope and baseline

Repository `MiladMahdavi1999/gif-platform`; branch `codex/b09-staging-release-gate`; fetched latest main at **91966ed3e67a1a3c141771b5f47726fa34553964**. GitHub PR #9 is merged at that commit (2026-10-18); first-parent ancestry contains merged B00 PR #1 through B08 PR #9. All seven Phase 03 references were read, including exact SL-AC definitions. Existing runtime, CI, contracts, Docker, checksum migration workflow, B08 runbooks/reports and prior limitations were inspected before implementation. Phase 03 and governance files and every historical migration remain unchanged.

## Implementation

- Digest-pinned production build inputs; SHA-tagged local app/Worker/MinIO/edge image build, source labels and exact image/lockfile provenance. No registry publication.
- Isolated loopback HTTPS staging Compose, production runtime, private versioned storage, separate least-privilege DB/S3 API/Worker identities, preserved decoder/container sandbox, no source mounts or automatic dev seed.
- Configuration validation; independent infra, transactional idempotent migration, explicit role/bucket provisioning, separately authorized nonproduction identity bootstrap, controlled application start and real readiness.
- Deterministic OpenAPI v1 artifact and retained compatibility artifact, corrected application error status documentation, explicit boundaries/security/budgets/headers and registered-runtime-operation drift test. No staging HTTP endpoint.
- Real Chromium staging journey, safe linked result/image/audit evidence; paired quiescent database/full-versioned MinIO backup and disposable restore with exact derivative hash/audit/revocation verification.
- Required independent `b09-staging` CI job alongside all B00–B08 gates; no conditional test skip/mocks in real staging.

Detailed changed-file rationale is the final PR diff. Operational documentation: [deployment/bootstrap](B09-staging.md), [backup/restore/rollback](B09-recovery.md), [smoke/evidence](B09-smoke.md), [exact acceptance matrix](B09-acceptance.md), [A/B/C release gate](B09-release-gate.md).

## Executed commands and observed results

Initial local observations (not promoted to a passing release gate):

- `git fetch origin main` and `git switch -c codex/b09-staging-release-gate origin/main`: successful; B00–B08 ancestry verified. Network-enabled sandbox execution was required for local proxy/Docker access.
- Environment initially supplied pnpm 11.25.0; frozen install correctly refused the engine mismatch. Installed pnpm **10.34.7** under ignored `work/tooling` with workspace-local npm/cache paths, then `pnpm install --store-dir work/pnpm-store --frozen-lockfile`: successful, lockfile unchanged.
- `pnpm typecheck`, `pnpm lint`, `pnpm api:generate`: executed during implementation; current final results recorded after CI.
- PostgreSQL fixture: `docker compose -f infra/compose.db-test.yaml up -d --wait`; `ALLOW_DATABASE_INTEGRATION_TESTS=true TEST_DATABASE_URL=postgresql://gif_platform:<nonproduction-fixture-password>@127.0.0.1:55432/gif_platform_test pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts --exclude packages/db/src/public.integration.test.ts`: **36/36 PASS**, four files, zero skipped. The test connection value is the committed nonproduction fixture in `infra/compose.db-test.yaml`; no private deployment credential is recorded here.
- Initial `pnpm test` in the default network-isolated command sandbox: **99 passed / 5 failed**, one uncaught loopback-listen EPERM, total 104. This attempt is not a pass. A network-enabled rerun is recorded separately; no test assertion was weakened for the environment.
- `BUILDX_CONFIG=$PWD/work/buildx docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" --build-arg SOURCE_REVISION=91966ed3e67a1a3c141771b5f47726fa34553964 -f infra/minio/Dockerfile -t gif-platform-minio:b09-build-probe .`: **BLOCKED** at `google.golang.org/api@v0.230.0` dependency download redirected to forbidden `storage.googleapis.com`. This non-deployable probe is not image provenance or a successful staging run. No bypass or alternate unreviewed MinIO runtime was used.

CI source of truth: pending first B09 PR/run. Final code SHA, exact counts, step outcomes, artifact links and safe retained evidence will replace this pending state after execution. Do not treat a pending check, historical B08 result, script existence or unexecuted runbook as PASS.

## Acceptance, smoke and recovery

All twelve current B09 statuses are **NOT VERIFIED** until required regression/staging CI completes. See the exact matrix for component and executable-test mappings, stop-the-line invariants, gaps and responsible follow-up. Production-mode image boot, actual staging smoke and restore drill are currently **NOT VERIFIED**. Local storage-dependent full integration/browser checks are blocked by the MinIO source download policy. Independent CI is configured to run these without local contaminated fixtures.

Cross-release application rollback remains a documented compatibility procedure, not an executed guarantee. The implemented restore drill verifies one release's paired cold snapshot, exact pinned private media and retained decisions. Production DR, off-host backup, RTO/RPO and future schema reversibility are not certified.

## Release assessment and review items

A: First Buildable Slice technical acceptance — NOT VERIFIED pending execution. B: local staging readiness — NOT VERIFIED pending execution. C: production/public-internet launch — **BLOCKED** by explicit rights, privacy, security, infrastructure, retention, operations and governance follow-up in the separate gate. A/B cannot approve C.

Provisional human review items: local CA/ports/credential handling, cold MinIO filesystem backup compatibility, single-host resource budgets, current shared runtime image footprint and future schema/image rollback compatibility. No hosting purchase, external image publication, public deployment, governance update or future feature was performed. Any governance acceptance must be separately approved using the proposal in the release assessment.
