# Coding Agent Handover — Codex / Cursor

**Document:** P3-AGENT-01 | **Version:** 0.1 | **Date:** 2026-10-15 | **Use:** ready-to-paste handoff for a real coding agent. Technical recommendations are Provisional; no product code was generated during Phase 03.

## 1. Handover contract and package map

Give Codex/Cursor **all seven** Markdown documents in this Phase 03 packet (attach them, or place at `docs/phase03/` in an empty/new repository):

| Document | Agent use |
|---|---|
| `Platform-Architecture-Blueprint.md` | Source Inventory, hierarchy of truth, platform-wide module boundaries; don't implement whole platform |
| `Technology-Stack-Decisions.md` | Proposed Stack, local environment, compatibility checks and assumptions |
| `First-Buildable-Slice.md` | User-visible first flow, Slice exclusions and SL-AC test IDs |
| `First-Slice-Technical-Specification.md` | Core contracts, DB schema, state transitions, security and deployment for slice |
| `Implementation-Backlog.md` | B00…B09 order and per-task runnable DoD |
| `Coding-Agent-Handover.md` | This document, agent workflow and first prompt |
| `Architecture-Decisions.md` | Proposed ADRs, reversibility and risk gates |

**Source artifact qualification:** Current project files include Phase 02 P2-WP07 Working Scope/PRD in a ZIP, not loose top-level. The user's current instruction adopts Phase 02 as **Working Baseline**; earlier P2-WP07 itself labeled all decisions provisional. Do not turn every P2-WP07 candidate into approved build scope, and do not edit governance files. The first task is **B00 only**; implementation phases B01…B09 require separate tasks/review.

## 2. Intended repository and stack

```text
gif-platform/
  apps/web/                     # Next.js 16.x / React
  apps/api/                     # Fastify 5.x, /api/v1/health/*
  apps/worker/                  # TS worker process, no processing job until B04
  packages/config/             # env schema
  packages/contracts/          # Zod/OpenAPI contracts, progressively filled
  packages/domain/             # domain types/invariants, progressively filled
  packages/db/                 # PostgreSQL 17 + Drizzle migrations (B01)
  packages/storage/            # S3 adapter/MinIO local
  packages/testing/
  infra/compose.yaml           # web,api,worker,db,minio,edge
  infra/caddy/Caddyfile         # :8080 -> web and api/media
  infra/minio/
  infra/docker/
  tests/e2e/
  docs/phase03/                # seven design files, unmodified reference
  .github/workflows/ci.yaml
  .env.example
  pnpm-workspace.yaml
  pnpm-lock.yaml
  package.json
  README.md
```

**Selected Provisional technologies:** TypeScript `strict`, Node.js 24.x LTS, pnpm, Next.js 16.x Active LTS, Fastify 5.x, Zod, Drizzle/`pg`, PostgreSQL 17, S3-compatible local MinIO, Caddy single-origin edge, FFmpeg/ffprobe pinned in later worker image, Vitest, Playwright, GitHub Actions. Exact compatible stable patch/minor versions are resolved/pinned by Coding Agent during B00 (no floating `latest` in production CI), and must be recorded. No Redis, Kafka, OpenSearch, Kubernetes, native SDK or public Developer Portal in first task.

**Future local browser address:** `http://localhost:8080`. Single-origin paths `/` → Web; `/api/*` and `/media/*` → API (when those routes exist). Browser-direct S3 `localhost:9000`, API-internal S3 `minio:9000`; S3 signing strategy and policy tested B03. Source object must stay private. Auth, worker transcoding and moderation are **not built in B00**.

## 3. Agent execution rules for every task

1. **Read** requested `Bxx` in `Implementation-Backlog.md` and relevant portions of technical spec; treat all architecture recommendations as Provisional. Do not build Bxx+1 or widen scope unasked.
2. **Inspect repo** before changing files. When repo empty, scaffold cleanly rather than assume pre-existing package layout. Preserve user changes and don't silently overwrite conflicting files.
3. **Plan briefly** (files/commands/risks) in coding-agent response, then implement directly. Do not require new product research, new phases or intermediate owner questions for noncritical local engineering details; label pragmatic choices as Provisional.
4. **Run commands actually** in the agent's environment. A unit test is not “passed” if it was never executed. If Docker/network/dependency fetch unavailable, implement best effort, state blocker with exact command/error and leave tests `NOT RUN`.
5. **Build runnable checkpoints.** Every task should have a browser or API smoke route and negative tests for state/security if relevant. Don't fabricate health success by returning `200` when DB/object store is down.
6. **Check guardrails:** `Account ≠ Channel ≠ Developer Key`; seven distinct media axes; no raw upload exposed; approval never automatic; Picker selection ≠ Host Send; no claims of instant CDN purge; no unlicensed fixture imports.
7. **Output a compact handover:** touched files, actual command lines and results, browser URL and manual steps, unresolved issues, next task still unstarted. Propose ADR changes, never silently mutate `Project-Decision-Log.md`, `Project-Status.md` or roadmap.

## 4. Ready-to-paste FIRST prompt — Task B00 only

Copy the following as the **first message to Codex/Cursor** after placing the seven files in `docs/phase03/` (or attaching them in the coding agent's workspace):

```text
You are the implementation engineer for the independent GIF Platform.

Read these project references first (they are Provisional Phase 03 documents, not owner-approved feature scope):
- docs/phase03/Platform-Architecture-Blueprint.md
- docs/phase03/Technology-Stack-Decisions.md
- docs/phase03/First-Buildable-Slice.md
- docs/phase03/First-Slice-Technical-Specification.md
- docs/phase03/Implementation-Backlog.md
- docs/phase03/Architecture-Decisions.md
- docs/phase03/Coding-Agent-Handover.md

TASK: Implement B00 ONLY — 'Repository skeleton and reproducible local health' from Implementation-Backlog.md. Do NOT implement B01 or later, nor upload/auth/moderation/search/picker logic yet. Keep all original docs unchanged.

Context and constraints:
1) Independent platform; do not copy GIPHY code, branding, copyrighted media, architecture internals or proprietary assets.
2) Preserve canonical 12 project phases, 10 systems and 4 delivery milestones. Do not edit any Project-Master-Roadmap.md, Project-Decision-Log.md, Project-Status.md or Phase 02 reference source files.
3) Build a modular-monolith skeleton: pnpm TypeScript monorepo, Node.js 24 LTS, Next.js 16.x web, Fastify 5.x API, worker process scaffold, internal packages, PostgreSQL 17 and S3-compatible MinIO local, Caddy single-origin reverse proxy. Use version-compatible stable dependencies, record exact pinned versions in lockfile, and explain compatibility choices. Avoid Nx/Turborepo, Redis, RabbitMQ, OpenSearch, Kubernetes and all nonessential services.
4) Repository layout should follow the Handover and Technical Spec. Apps/web must not import packages/db. No product domain operations implemented now. Worker only starts, logs a safe ready/no-op status and shuts down gracefully; do not pretend real media jobs run yet.
5) Deliver an operational home page at http://localhost:8080 with the text 'GIF Platform — local development' and an accurately labeled health indicator. API endpoints under /api/v1/health/live and /api/v1/health/ready; /live can report process up, /ready must check actual dependency reachability (PostgreSQL and object-store health) and report 503 if unhealthy, without leaking secrets.
6) Local topology: Caddy :8080 -> Next :3000 for / and Fastify :4000 for /api/* and future /media/*; Postgres at db:5432; MinIO internal minio:9000 and browser-local localhost:9000. Ensure Docker Compose healthchecks, named volumes and graceful shutdown. Any database migrations/seed actions are placeholders with clear failure/not-implemented behavior until B01; never fake success.
7) Create a safe .env.example (local placeholder credentials only), .gitignore with .env and secrets, pinned pnpm workflow, strict TypeScript, lint/typecheck/format/testing setup, package build scripts, a minimal API health test and config-validation test (Vitest), and basic CI config. Do not commit real credentials.
8) Create README with ONE precise path for getting a clean clone running (Docker Compose full stack or a proven hybrid path); list exact tested commands for boot, health, lint, typecheck, build, unit tests, shutdown and reset. If a script is not yet implemented (db migration, integration, e2e), explicitly say NOT IMPLEMENTED and make it fail clearly rather than be a no-op green check.
9) Prefer conventional simple files and maintainable boundaries. Any unavoidable deviations from the proposed stack/layout must be explained as Provisional; do not quietly redefine product scope.

Acceptance criteria (must verify, not merely write):
A. Fresh checkout + README steps can bring up edge/web/api/worker/db/minio; browser '/' visibly renders.
B. GET http://localhost:8080/api/v1/health/live returns HTTP 200. GET /api/v1/health/ready returns HTTP 200 only if DB and object-store are reachable; when DB or MinIO is stopped, it returns non-200/503 (test dependency failure honestly).
C. pnpm lint, pnpm typecheck, pnpm build and pnpm test run and pass (record real output). Run an HTTP smoke test via the single-origin ingress.
D. Secrets not in source, lockfile exists, no application routes or media jobs beyond B00; original docs/governance untouched.
E. Clearly report tests that cannot run (e.g., Docker daemon unavailable); do not claim completion in that case.

Execution workflow:
- Inspect workspace and available tools first.
- Briefly outline B00 file actions.
- Implement B00, then run tests, build and smoke including the negative /ready case.
- Provide a final task report with: changed file list, exact commands/results, browser URL and manual smoke steps, unresolved issues/deviations, and explicit statement 'B01 NOT STARTED'.

Do not ask broad product questions; resolve routine local engineering details with a documented Provisional default. Stop after B00.
```

## 5. Task B01 onward — simple follow-up prompt template

For subsequent tasks, reuse the same seven project docs and replace only the task line, e.g.:

```text
Continue in the existing GIF Platform repository. Inspect the actual B00 code and reports first. Implement only B01 from docs/phase03/Implementation-Backlog.md using First-Slice-Technical-Specification.md. Preserve tested B00 behavior; add real PostgreSQL migrations and schema constraints, dev-only seed and tests. Run old and new gates, demonstrate browser+API still boot, report exact results, do not start B02 or modify governance files.
```

**Important:** This is an example for **after B00 has actually passed**, not permission to skip or bundle B01…B09 into one huge change.

## 6. Acceptance evidence to keep in repository once implementation starts

Recommended minimal evidence files (not produced in Phase 03): `docs/implementation/B00-report.md`, subsequent per-task reports, `docs/implementation/known-gaps.md`, `openapi.json` when endpoints exist, integration/E2E test logs in CI artifact. Avoid logging password/session/S3 secrets in evidence. When a test is unexecuted, explicitly list `NOT RUN`. Do not rewrite previous Accepted-with-Gaps evidence as verified.

**Local first-code goal:** one reproducible, typed, secured-by-default repository with honest readiness and a browser-visible homepage. Then B01 begins real domain foundation. No additional research/documentation phase is necessary to start B00.
