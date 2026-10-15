# Implementation Backlog — First Buildable Slice

**Document:** P3-BACKLOG-01 | **Version:** 0.1 | **Date:** 2026-10-15 | **Status:** Provisional implementation work plan, not an owner-approved product or release backlog.

## 1. Backlog execution contract

- One task = one focused PR/commit set **with running software and automated evidence**. Tasks are sequential because their integration gates are real; lightweight preparation may run in parallel only if the previous contract remains green.
- Coding Agent implements **only one specified task per prompt**; must report files changed, commands actually run, results, limitations and follow-up; do not claim tests pass without execution.
- All tasks include negative tests around unauthorized content access and zero automatic Host action. No silent scope expansion into SC-18 SDKs, advanced creation, Clips, enterprise or comprehensive Admin.
- Every task consumes shared constraints in `First-Slice-Technical-Specification.md` and `Architecture-Decisions.md` (proposal status preserved), and refers to Source Inventory in `Platform-Architecture-Blueprint.md`.
- No numerical SLA/scale promise. Local defaults are safety guardrails. Do not use third-party/GIPHY assets as fixtures. No migrations bypass/change governance files.
- **Ready:** source file available, acceptance clear, prior task DoD green. **Done:** code reviewed, required commands actually passed, feature demonstrated, docs/contracts/test assertions updated. **Blocked:** unresolved dependency with reproduced log, not a fabricated pass.

## 2. Ordered tasks and Definition of Done

### B00 — Repository skeleton and reproducible local health (FIRST AGENT TASK)

**Goal:** have a bootable monorepo where browser, API, worker scaffolding and local dependencies are wired. **No product feature code**, no fake upload or moderation endpoint.

**Create:** `apps/web`, `apps/api`, `apps/worker`; `packages/config`, `packages/contracts`, `packages/domain`, `packages/db`, `packages/storage`, `packages/testing`; pnpm workspace, strict TS, lint format/typecheck, `.env.example`, `.gitignore`; Docker Compose `web/api/worker/db/minio/edge`; Caddy routes; DB migration/seed script scaffolds; CI initial commands; concise README. API `GET /health/live` and `/health/ready` (database/object reachability with clear 503); web `/` renders 'GIF Platform — local development' and health indicator. Worker runs a no-op poll loop with clean shutdown but **no media job yet**.

**DoD:** a fresh checkout documented start command brings up all services; `http://localhost:8080` renders home; `http://localhost:8080/api/v1/health/live` returns 200 (routing must match actual prefixes); readiness reflects DB/storage; `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` pass (at least one health test + config validation). No `.env` secrets committed, deterministic lockfile, no placeholder success response masking missing dependencies; unimplemented scripts do not claim to have passed integration/E2E. README documents supported commands exactly as implemented.

**Manual smoke:** stop DB -> readiness 503; restore -> 200; stop API -> edge failure honest; inspect logs for secrets. **Output:** functioning infrastructure baseline, empty product home.

### B01 — Core SQL schema, migrations and test seed

**Depends:** B00.

**Create:** Drizzle schema and migration scripts matching **all core tables** in technical spec; migrations with checks/indexes; local-only seed for separate uploader/reviewer users using Argon2id password hashes; migration/rollback test; `db:reset` dev-only confirmation. `packages/domain` types for seven independent states and guards (without public features).

**DoD:** clean DB migrates/seed succeeds twice safely; real PostgreSQL schema constraints enforced, role separation defined, indexes exist and `search_documents` FTS generated column usable; production-mode seed refuses to run; tests for FK/unique/CHECK invalid transitions at domain level; homepage and health continue to run. Seed credential printing/logging prohibited; documented dev secrets only via `.env` (local sample can show nonproduction placeholders).

**Manual smoke:** inspect DB via script to show 2 distinct users and 0 assets; rerun migrations, no data deletion.

### B02 — Session login, CSRF and role authorization

**Depends:** B01.

**Create:** `/api/v1/auth/login`, `session`, `logout`; session DB persistence, Secure/HttpOnly rules, authz middleware, Argon2id; `/login` form and signout; Origin/CSRF controls + retry/rate guard. Role checks for an internal `reviewer-required` test route only if explicitly gated/nonpublic; prefer meaningful `/review` stub with 403 for uploader.

**DoD:** browser login/logout working with seeded test users; anonymous `GET /` okay; unauthorized review 401; uploader review 403; reviewer review 200; spoofed Origin/CSRF rejected; nonexistent/expired/revoked sessions not accepted; session tokens never logged and login errors uniform; prior green.

**Manual smoke:** two browsers with different roles, refresh preserves session, logout destroys server-side session.

### B03 — Actual S3 direct upload and durable receipt (private)

**Depends:** B02.

**Create:** presigned POST intent `/uploads`, completion `/uploads/:id/complete`, private object storage provisioning, MinIO CORS, exact HEAD verification, size/MIME policy, owner list/detail; `/studio/upload` and `/studio/assets/:id` with real progress/status, no media preview. Idempotent create/complete. Job row enqueued transactionally; worker can leave job READY.

**DoD:** own animated test GIF reaches private quarantine, response `202 RECEIVED/QUEUED`; `upload_sessions` and `asset_states` persisted; browser signed POST tested against `localhost:9000` and policy; no anonymous/quarantine direct reads; expiry/missing object/claimed size mismatch/duplicate completion/other-owner fail in real integration tests; no permanent credentials sent to browser; progress truthfully says *received, not published*; prior green.

**Manual smoke:** upload GIF, refresh owner receipt; anonymous search/URL still empty/404.

### B04 — Durable lease worker and safe animation processing

**Depends:** B03.

**Create:** concurrent-safe `media_jobs` claim/retry/heartbeat, FFprobe metadata validation and bounded FFmpeg render; private `DISPLAY_GIF` + `POSTER_PNG`; error taxonomy; temp sandbox; worker boot/restart and logs; owner receipt polling. Processing success sets technical READY and review PENDING but never PUBLIC.

**DoD:** valid fixture processing produces **animated** decoded display GIF and static poster, correct dimensions and hashes; valid file stays nonpublic; malformed/still/oversized/duration/timeout fail deterministically; crash after derivative upload and before DB commit is recovered idempotently; two workers do not complete twice; lease expiry and max retry tested; stdout/secrets/paths not exposed; previous tasks green.

**Manual smoke:** restart worker during work, observe truthful states and bounded recovery.

### B05 — Reviewer queue, approval/rejection, audit and takedown

**Depends:** B04.

**Create:** protected `/review`, queue/detail safe derivative preview, decision/REMOVE HTTP contracts, `moderation_decisions`, transactional audit, `row_version` conflict, processing/rights prerequisites. Approval transaction creates `search_documents` projection and authorization states; rejection/removal invalidates query/index and authorization.

**DoD:** distinct reviewer approves processed GIF; uploader cannot; two simultaneous decisions cannot both win; expectedVersion and stale approvals yield 409; rejection reason required; pending/rejected/remove preserved historical audit and hidden from public; moderation operator preview never serves original uploaded object; no session elevation; previous green.

**Manual smoke:** review item and see `APPROVED` or `REJECTED`, inspect audit using read-only script.

### B06 — Public search, gallery, detail and policy-gated media origin

**Depends:** B05.

**Create:** `/api/v1/public/gifs`, `/public/gifs/:id`, `/media/:assetId/:variant`, FTS and tag indexing; web public `/`, `/g/:id`, SEO metadata; poster, GIF playback/reduced-motion states; typed errors/cursors. Constrain search result by **all** policy gates even if projection stale.

**DoD:** approved GIF searchable by title/tags with stable ordering; anonymous detail renders sanitized GIF; rejected/pending/removed cannot be found/read/streamed (including guessed ID); removal blocks subsequent media origin GET; missing derivative produces 503 and records technical degraded state when validated; no raw original URLs; typed query/empty/failure states; accessible keyboard and reduced-motion handling; previous green.

**Manual smoke:** approval → public search; removal → search empty and media denied (explicit limitation: previously downloaded bytes may remain).

### B07 — Embedded browser Picker + honest Host demo

**Depends:** B06.

**Create:** Picker UI search/grid/preview/select/cancel in `/demo/host-picker`, typed callback, loading/empty/restricted/error, focus trap/restoration, Escape, keyboard selection. Demo Host selection receipt distinct from a send/post action. No external SDK packaging.

**DoD:** search and select approved item yields `selected` reference; Escape/cancel yields `cancelled`; clicking repeated sends only one callback; unauthorized/removed item not selectable on fresh reads; Host demo never calls a send/post endpoint, logs no `sent` success; responsive/accessibility tests and Playwright full happy path pass; previous green.

**Manual smoke:** choose GIF, verify UI clearly says “Selected; no host action performed”; cancel and recover focus.

### B08 — Failure recovery, operations and CI gate hardening

**Depends:** B07.

**Create:** negative and chaos tests (worker killed, DB unavailable, object missing), rate/size guardrails, operator retry visibility (minimal internal endpoint/script, not full Admin), clean-health/liveness separation, structured request IDs, test fixtures; CI job with deterministic fresh volumes. S3 orphan cleanup a bounded documented runbook/tool with safe dry-run, **not** arbitrary global delete.

**DoD:** tests prove timeout/idempotency/state invariants; no jobs stuck forever after legitimate lease expiry; no partial approval; rate-limit and CSRF/Origin tests green; no sensitive data in logs; no CI action silently skipped. At least one error injection demonstrates truthful non-200 API and safe user message. README includes diagnose/retry instructions.

**Manual smoke:** kill worker then restore; upload item eventually processes or reaches explained terminal failure.

### B09 — Staging-ready build package, contract audit and release gate

**Depends:** B08.

**Create:** built/tagged image workflow, versioned OpenAPI output drift test, migrations deployment policy, staging Compose/infra template, backups/restore runbook draft, smoke checklist and rollback instructions. Do not buy/configure unapproved production vendor; staging may be local production-mode images with injected nonproduction secrets.

**DoD:** clean staged images boot without dev seed; explicit bootstrap path only; one authorized GIF fixture traverses end-to-end; all SL-AC-01…12 passing or clearly tracked failures before claiming slice complete; audit event trail present; all seven Markdown design files stay reference-only (not substituted for runtime tests); original governance files untouched.

**Manual smoke:** `staging smoke` script produces linked evidence of health/upload/review/search/picker/removal. Production/public internet launch remains blocked by unresolved rights/privacy/security/ops approvals.

## 3. Acceptance and CI matrix

| Gate | B00 | B01 | B02 | B03 | B04 | B05 | B06 | B07 | B08 | B09 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Build/typecheck/lint | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Health smoke | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DB integration | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Auth/permission tests | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Local S3 browser POST | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Worker fixture/crash tests | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Review/public denial tests | — | — | — | — | private denied | ✓ | ✓ | ✓ | ✓ | ✓ |
| Public browser E2E | Home | Home | Login | Receipt | Pending | Review | Gallery | Picker | Recovery | Full |

`—` means **not yet applicable**, not “passed”. Actual test execution is the agent's responsibility; the matrix represents required gates, not observed results.

## 4. Priority dependencies and traceability

| Work unit | Technical handoff | Related Phase 02 baseline | First-slice acceptance |
|---|---|---|---|
| B00–B01 | Environment, SQL, semantics | `SC-04/06/07/14`, `FR-MEDIA-01…07`, `AX07-01…07` | infrastructural preconditions |
| B02–B03 | Identity → upload receipt | `SC-06/07/24`, Rights rule BR07-006 | SL-AC-01, 07, 09 |
| B04 | Worker and variants | `SC-04/14`, independent Media axes | SL-AC-02, 03, 08, 12 |
| B05 | Trust decision and projection | `SC-21/23/24`, media axis gates | SL-AC-03, 04, 06, 07 |
| B06 | Search and safe delivery | `SC-01/02/09/14/22` | SL-AC-04, 06, 11 |
| B07 | Picker + Host selection only | `SC-19/35`, BR07-001/003, CTX-A & B unranked | SL-AC-05, 10 |
| B08–B09 | Release gates, traceability | `SC-30/31`, service-state and rights uncertainty | All SL-AC-01…12 |

**Stop-the-line defects** (block task Done): unreviewed content can be loaded publicly; uploader approves own media; raw input served; replay creates a second independent public asset; job race makes duplicate inconsistent variants; `selected` claims Host `sent`; take-down can still be served from uncached origin after commit; leaked credentials/keys; success reported without executed tests.

## 5. Working agreement with Coding Agent

Each task delivery summary must contain:

```text
Task: Bxx
Changed files / rationale:
Commands executed (copy exact command):
Results with pass/fail and logs/URLs:
Manual browser steps + observed outcome:
New assumptions or decisions requested (remain Provisional):
Known gaps / risks:
Next unstarted task:
```

Never silently edit `Project-Master-Roadmap.md`, `Project-Decision-Log.md` or `Project-Status.md`. Design docs here are starting proposals; when implementation exposes a mismatch, prepare a proposed ADR amendment (not a forced scope change). Each PR should be reviewable by a human before moving on.

**Immediate next action:** take **B00 only** and run the exact Coding-Agent prompt in `Coding-Agent-Handover.md`.
