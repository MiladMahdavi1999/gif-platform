# GIF Platform — B00

Local modular-monolith bootstrap only: Next.js home, Fastify health API, idle
worker, PostgreSQL 17, MinIO and Caddy. **B01 NOT STARTED.**

Full B00 acceptance is currently blocked by the recovery environment's network
policy during the MinIO source build. The six-service startup and healthy-state
tests are not yet verified; see the [actual results](docs/implementation/B00-report.md).

The seven original Phase 03 documents remain unchanged at the repository root;
`Coding-Agent-Handover.md` and `Implementation-Backlog.md` define this task.
Implementation choices remain Provisional. There are no domain tables,
authentication, uploads, media routes, processing jobs or public buckets.

## Run a clean clone

Prerequisites: Node.js **24.19.0** with npm, Docker Engine with Compose v2 and
BuildKit, access to npm/GitHub/Go module and Docker registries. Use this **full
Compose** path; host applications do not connect to container-only hostnames.
The pinned pnpm version is invoked through npm so a different system pnpm cannot
silently change the lockfile.

```sh
cp .env.example .env
npx --yes pnpm@10.34.7 install --frozen-lockfile
npx --yes pnpm@10.34.7 dev
npx --yes pnpm@10.34.7 test:smoke
```

Open **http://localhost:8080**. The heading reads
`GIF Platform — local development`; the live status should become
`Dependencies ready — PostgreSQL and object store reachable`. It polls the API
every five seconds and displays failures honestly. JavaScript is required for
the live indicator; the initial server-rendered state is “Checking dependencies…”.

All six services must become healthy. The worker's health means its **idle loop
is alive**, not that it can process jobs. The first MinIO source build takes
longer than a normal image pull. Its pinned source release and rationale are in
[infra/minio/README.md](infra/minio/README.md).

Only Caddy `127.0.0.1:8080` and MinIO `127.0.0.1:9000` are exposed to the host.
API, web and PostgreSQL are internal to Compose. `db:5432`, `minio:9000`,
`web:3000` and `api:4000` are container addresses. Caddy preserves `/api/*` and
`/media/*` when forwarding to the API; other requests go to Next.js.
`.env.example` contains disposable local placeholders; `.env` is ignored. Keep
`DATABASE_URL` credentials consistent with `POSTGRES_*`. Changing credentials
does not rewrite an already initialized PostgreSQL volume.

## Checks

Run from the repository root:

```sh
npx --yes pnpm@10.34.7 format:check
npx --yes pnpm@10.34.7 lint
npx --yes pnpm@10.34.7 typecheck
npx --yes pnpm@10.34.7 test
npx --yes pnpm@10.34.7 build
npx --yes pnpm@10.34.7 test:smoke
npx --yes pnpm@10.34.7 exec playwright install --with-deps chromium
npx --yes pnpm@10.34.7 test:e2e
node scripts/test-dependency-failures.mjs
```

The final command stops/restores this local project's DB, MinIO and API. It
asserts real HTTP failure/recovery through Caddy and the corresponding browser
status. Run it only on this disposable local stack, without concurrent tests.
It restores each stopped service in `finally`. For a preinstalled Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` on browser commands
instead of downloading a second browser.

Health contracts:

- `GET /api/v1/health/live`: HTTP 200, `{"status":"ok"}` while API is running.
- `GET /api/v1/health/ready`: actual `SELECT 1` with connection/query timeouts and
  MinIO `/minio/health/ready` with a 1.5-second timeout. HTTP 200 only when both
  succeed; otherwise HTTP 503 with `up`/`down` per dependency. Responses include
  no connection errors, URLs or credentials, and are not cached.
- If API is stopped, Caddy returns HTTP 502; the home remains available and
  reports that the API is unavailable.

For manual failure checks, run `docker compose --env-file .env -f infra/compose.yaml stop db`,
refresh `/api/v1/health/ready` and watch the home status. Restore with the same
command ending in `start db`; repeat for `minio` and `api`.

Database migration and seed are **NOT IMPLEMENTED (B01)**. Both commands below
exit 1 with a clear message and make no changes. Domain/database integration is
also **NOT IMPLEMENTED**, and `test:integration` exits 1. B00's real dependency
checks are the smoke/failure commands above, not a claim of domain integration.

```sh
npx --yes pnpm@10.34.7 db:migrate
npx --yes pnpm@10.34.7 db:seed:dev
npx --yes pnpm@10.34.7 test:integration
```

## Stop, reset and diagnose

```sh
npx --yes pnpm@10.34.7 stop
# Destructive: removes only this Compose project's disposable local volumes.
docker compose --env-file .env -f infra/compose.yaml down --volumes
# Boot again with the same documented path:
npx --yes pnpm@10.34.7 dev
```

Named volumes persist PostgreSQL, MinIO and Caddy data across ordinary shutdown.
API and worker handle SIGTERM/SIGINT; Compose grants ten seconds for shutdown.
Inspect service state with
`docker compose --env-file .env -f infra/compose.yaml ps` and local logs with
`docker compose --env-file .env -f infra/compose.yaml logs --tail=50`.
Do not publish `.env` or resolved Compose configuration, which contains local
credentials. API request logging is suppressed; startup errors are sanitized.

## Versions and boundaries

Exact JS versions and transitive resolutions are in `pnpm-lock.yaml`. Node
24.19.0, pnpm 10.34.7, TypeScript 5.9.3, Next 16.4.1, React 19.3.1, Fastify
5.12.7, Zod 4.6.7, pg 8.23.1, Vitest 5.0.5 and Playwright 1.64.1 are pinned.
TypeScript 5.9 stays within typescript-eslint's supported `<6.1` range. ESLint
9.39.5 stays within the Next plugins' declared peer range; npm marks that ESLint
line deprecated. This is a development-tool limitation to revisit when those
plugins support ESLint 10. No unsupported peer override is used.

Container bases use exact release tags: Node 24.19.0 bookworm-slim, PostgreSQL
17.6 bookworm, Caddy 2.10.2 alpine and Go 1.24.8 bookworm for the pinned MinIO
source build. These are local development images, not a production deployment
approval. Drizzle schema/migrations start in B01; S3 object operations and bucket
provisioning start in B03; FFmpeg starts in B04. Empty domain/testing package
boundaries reserve their locations without prebuilding later tasks.

Web imports only browser-safe contracts. ESLint blocks DB/storage imports into
web and API/web framework imports into worker. Packages compile to ESM with
strict TypeScript. There is no additional monorepo orchestrator or service.

## Managed cloud builds

BuildKit accepts an optional `proxy_ca` secret for the networked Docker build
steps. Ordinary local Docker needs no override. In a managed cloud environment,
use its supplied CA and proxy configuration. Add an **ignored** Compose override
which supplies `build.secrets: [proxy_ca]` for `api`, `web`, `worker` and `minio`,
and declares `secrets.proxy_ca.file` as the supplied CA bundle path. Pass that
override after `infra/compose.yaml`. Never copy a session CA or credential into
an image or disable TLS verification. This session's exact override invocation
is recorded in [the B00 report](docs/implementation/B00-report.md).

CI runs the same checks plus Compose, browser and real failure tests. A configured
workflow is not evidence that a remote CI run passed. Executed results and known
gaps are recorded in [docs/implementation/B00-report.md](docs/implementation/B00-report.md).
