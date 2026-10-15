# Technology Stack Decisions — Proposed Architecture for First Slice

**Document:** P3-TECH-01 | **Version:** 0.1 | **Date:** 2026-10-15 | **Approval:** all new technical choices **PROVISIONAL**, not DEC-confirmed. Corresponding proposed ADRs: `Architecture-Decisions.md`.

## 1. Stack selection

| Layer | Recommended technology | Why this now | Alternative / explicit cost |
|---|---|---|---|
| Monorepo | **pnpm workspaces + TypeScript strict + Node.js 24 LTS** | One language across Web/API/worker/contracts; deterministic lockfile; minimal orchestration | npm workspaces is valid; monorepo tooling Nx/Turborepo deferred until measured need |
| Web | **Next.js 16.x + React + server-rendered routes where useful** | Good public metadata/detail and browser-facing studio/picker; common TS contracts | Vite SPA is simpler but requires explicit SSR/search indexing plan; not needed yet |
| HTTP API | **Fastify 5.x**, modular feature plugins/routes; **Zod** for validation and OpenAPI generation via a tested adapter | Strong HTTP performance and low ceremony; one modular API domain | NestJS brings more DI structure and boilerplate; microservices premature |
| SQL access/migrations | **Drizzle ORM + `pg` + SQL migrations** | Explicit PostgreSQL schema, typed queries, raw `tsvector`/DDL supported | Prisma is viable but schema generation and specialized SQL may require additional escape hatches |
| Database | **PostgreSQL 17** (local baseline; production provider pending) | Transactions, FK/unique constraints, FTS, `SKIP LOCKED` durable jobs | MongoDB adds cross-object state management complexity; external ES not needed to show E2E flow |
| First search | **PostgreSQL `tsvector`, `websearch_to_tsquery('simple', ...)`, tags** | Approval+index write can be atomic; no extra service/synchronization | OpenSearch, Meilisearch useful later for typo tolerance/advanced relevance, but have indexing lag and operational footprint |
| Background jobs | **PostgreSQL durable `media_jobs` + leases and bounded retry** | Reuses transactional DB, avoids Redis early, job enqueue can be in same transaction as state | BullMQ+Redis or RabbitMQ/Kafka for proven throughput/replay needs later |
| File storage | **S3-compatible storage contract**; **MinIO for local only** | Direct browser upload via short-lived presigned POST; isolate bytes from SQL | Filesystem is easy locally but poor portability; production object vendor, encryption, license review to be decided |
| Processing | **FFmpeg + ffprobe**, version-pinned container, no external codecs by default | Tested animation decode/re-encode and poster; avoids bespoke media implementation | Sharp/libvips useful for static images, animated WebP path can be evaluated separately; not necessary for GIF-first |
| Login for slice | **Server-side opaque sessions** in PostgreSQL, Argon2id password hashing, secure HttpOnly cookie, Origin/CSRF validation | Real isolated uploader/reviewer privileges without external IdP dependency | Hosted OIDC/passkeys later; demo-only auth bypass forbidden |
| Browser-facing edge | **Caddy** local single-origin reverse proxy, production ingress replaceable | `/` → Next; `/api`, `/media` → Fastify; consistent cookie / CORS behavior | Next rewrites can work but large media proxy through Next is an avoidable coupling |
| API contracts | **OpenAPI 3.1**, checked-in generated spec and Zod shared DTOs where safe | Agent can implement contract-first, verify response and error shapes | GraphQL adds unnecessary surface before public API decisions |
| Tests | **Vitest**, API integration tests with PostgreSQL/MinIO, **Playwright** browser E2E; media fixtures | Unit / integration / lifecycle / role checks; directly observable success | Snapshot-only tests insufficient for workflow correctness |
| CI | **GitHub Actions** example; package manager lock, lint/typecheck/unit/integration/build/e2e | Familiar, portable automation; host provider not mandated | Any equivalent CI allowed; pipelines are repo artifacts, not platform business decisions |
| Observability | Structured logs (Pino), OpenTelemetry hooks, `/health/live` + `/health/ready`, basic operational metrics | Correlate upload/jobs/requests, avoid full analytics product for slice | Prometheus/Grafana/collector hosted products can follow measured requirement |

**Version hygiene:** At research cut-off, Node.js release announcements list **24.x LTS** and Next.js support policy lists **16.x Active LTS** (Next 16.4 was announced 2026-10-06). References: https://nodejs.org/en/blog/release ; https://nextjs.org/support-policy ; https://nextjs.org/blog . Runtime/code dependencies must be pinned to tested exact versions/lockfile **by the coding agent during repository setup**; do not pretend this proposal is a verified dependency compatibility lock. Check Fastify/Next/Drizzle integration and security advisories at implementation time. Do not use experimental Next features for the first slice without justification.

## 2. Architectural style decision: modular monolith vs microservices

| Evaluation | Modular monolith with separate worker (selected, Provisional) | Multiple microservices (not selected) |
|---|---|---|
| E2E build time | One deployable API, simple imports, few infra dependencies | Independent repos/CI/gateway/distributed auth need setup before a single GIF appears |
| Media CPU isolation | Worker process/container independent of API requests | Still needs worker separation; extra service orchestration |
| Transactions | PostgreSQL commit protects state, index and job intent | Eventual consistency, outbox/sagas become critical from day one |
| Future changes | Enforce module boundaries + adapter interfaces + schema ownership | Enables independent deploys but adds coordination/security/network cost |
| Extraction path | Extract Search or Media worker when supported by metrics | Early boundary mistakes produce permanent cross-service coupling |

**Rule:** worker is not a synchronous request handler; it may run separately without declaring a new independently versioned microservice. Do not create microservice-only infrastructure now. For first build, avoid service mesh, event streaming, Kubernetes, multi-region replicas, separate search cluster and heavy BI stack.

## 3. Exact environment and configuration contract

**Local topology:** browser `http://localhost:8080` → Caddy → `web:3000` or `api:4000`; PostgreSQL `db:5432`; MinIO API `minio:9000` and **browser-addressable** `localhost:9000` for presigned POST; worker shares database and object store. `S3_INTERNAL_ENDPOINT` and `S3_PUBLIC_ENDPOINT` must be different where DNS requires, while the **signed upload URL must target the hostname the browser actually sends**. CORS for MinIO restricted to the local web origin; no wildcard credential origins.

Minimum config keys (examples, all secret values externally injected):

```dotenv
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:8080
PORT=4000
DATABASE_URL=postgresql://gif_platform:local_only_secret@db:5432/gif_platform
SESSION_COOKIE_NAME=gif_session
SESSION_TTL_SECONDS=86400
CSRF_ORIGIN=http://localhost:8080
S3_INTERNAL_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_QUARANTINE_BUCKET=gif-quarantine
S3_DERIVATIVES_BUCKET=gif-processed
S3_ACCESS_KEY_ID=local_access_key
S3_SECRET_ACCESS_KEY=local_only_secret
MEDIA_UPLOAD_POLICY_TTL_SECONDS=600
MAX_GIF_UPLOAD_BYTES=20971520
MAX_GIF_PIXELS=16000000
MAX_GIF_DURATION_SECONDS=30
MEDIA_JOB_MAX_ATTEMPTS=3
MEDIA_JOB_LEASE_SECONDS=120
MEDIA_JOB_POLL_INTERVAL_MS=1000
```

All numeric upload/processing thresholds above are **Provisional local safety defaults, not market/product requirements, SLAs, or scale assumptions**. Make them config-driven and test their boundary behavior. Worker hard timeouts, CPU/memory limits and scan rules must be separately specified. In production, require HTTPS, secrets management, database backup and migrations, egress-restricted worker, and reviewed incident/removal policies.

## 4. Decision dependencies / constraints

1. **Object-store dual endpoint:** SDK signing must be verified with browser-accessible host; a signature generated for `minio:9000` fails if browser actually uses `localhost:9000` with signed Host header. Exercise this in integration/E2E tests, do not handwave.
2. **PostgreSQL FTS semantics:** `simple` tokenization and tags provide basic case-insensitive keyword lookup, **not** proven Persian stemming, advanced synonym support or language-neutral relevance. Do not promise universal search parity.
3. **Media safety:** FFmpeg binary from a maintained image, minimal privileges, network disabled, readonly root FS where feasible, temp quota and resource budgets. Do not serve raw unvalidated source.
4. **Privacy:** don't log passwords, session values, raw upload URL credentials, precise user data or media binary. Attribute each moderation decision to authorized actor.
5. **Rights:** user's checkbox/attestation is not a license clearance for broad commercial distribution; full policy/legal scope stays a gate.
6. **Object store license/operations:** local MinIO is a *development dependency*, not a binding production recommendation. Verify redistribution/operational and licensing obligations of any deployed MinIO distribution and choose production storage independently.
7. **Availability and race conditions:** local docker healthchecks and idempotency are necessary even without a numeric uptime promise; database/object store is not automatically a distributed transaction.

## 5. Not yet selected

Production cloud/region, CDN vendor, hosting provider, paid analytics, runtime observability vendor, secrets manager, email sender, OAuth provider, specific domain names, supported markets/locales, dedicated search vendor, production backup/DR numbers, load SLO, team topology. Each requires its own evidence/owner decision and does **not** block local coding of the first slice.

## 6. Proposed verification gate before first coding task

- Run `node --version` against a supported Node 24.x LTS image, pin lockfile; validate frontend/API/worker build and framework compatibility.
- Ensure `pnpm` version pinned through `packageManager`/Corepack or equivalent; no floating install in CI.
- Check FFmpeg/ffprobe actual available codecs and version in worker image; create a tiny known animated-GIF fixture for smoke tests.
- Test postgres raw FTS migration and `FOR UPDATE SKIP LOCKED` semantics under concurrency.
- Verify presigned POST policy + browser CORS in local MinIO end-to-end before calling upload finished.

**Approval request status:** proposals P3-ADR-001…009; no `DEC-010` or existing project governance entry created or implied. Refer to `Architecture-Decisions.md` for alternatives and consequences.
