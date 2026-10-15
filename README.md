# GIF Platform — B01

Local modular-monolith bootstrap only: Next.js home, Fastify health API, idle
worker, PostgreSQL 17, MinIO and Caddy, plus the B01 database foundation. **B02 NOT STARTED.**

B00 was merged in [PR #1](https://github.com/MiladMahdavi1999/gif-platform/pull/1).
See [B01 results](docs/implementation/B01-report.md) for current executed checks
and [B00 results](docs/implementation/B00-report.md) for the baseline.

The seven original Phase 03 documents remain unchanged at the repository root;
`Coding-Agent-Handover.md` and `Implementation-Backlog.md` define this task.
Implementation choices remain Provisional. The 13 core tables and pure state
guards exist; authentication, upload, moderation and search HTTP features remain
unimplemented. The worker remains idle.

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
npx --yes pnpm@10.34.7 db:migrate
npx --yes pnpm@10.34.7 db:seed:dev
npx --yes pnpm@10.34.7 db:inspect:dev
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
node scripts/test-local-lifecycle.mjs --confirm=gif_platform
```

The dependency-failure command stops/restores this local project's DB, MinIO and API. It
asserts real HTTP failure/recovery through Caddy and the corresponding browser
status. Run it only on this disposable local stack, without concurrent tests.
It restores each stopped service in `finally`. For a preinstalled Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` on browser commands
instead of downloading a second browser.

The lifecycle command checks worker shutdown and all service logs for configured
credentials, **deletes this project's disposable volumes**, reboots all six
services from the built images and asserts readiness again. Use it only on the
disposable development stack. CI retains the checked runtime log and browser
screenshots as an artifact.

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

## Database foundation (B01)

`packages/db/src/schema.ts` defines `users`, `role_grants`, `sessions`, `assets`,
`tags`, `asset_tags`, `asset_states`, `upload_sessions`, `asset_variants`,
`moderation_decisions`, `search_documents`, and `media_jobs`, plus `audit_events`.
UUID defaults, UTC timestamps, FKs, uniqueness, CHECKs and all specified indexes
are included. Audit UPDATE/DELETE/TRUNCATE is rejected by a database trigger.
`search_documents.search_vector` is a stored generated, weighted `simple` FTS
vector with a GIN index. It updates when title/tags change.

The recommended path stays **full Compose**: root database commands run a
one-off tooling container on the existing Compose network, using the app image
built by `pnpm dev`. They never start auth or processing features. Rebuild that
image with `pnpm dev` after changing database code/migrations.

```sh
npx --yes pnpm@10.34.7 db:migrate
npx --yes pnpm@10.34.7 db:seed:dev
# Safe to repeat: no duplicate users/grants or replacement passwords.
npx --yes pnpm@10.34.7 db:migrate
npx --yes pnpm@10.34.7 db:seed:dev
# Prints only seeded user UUIDs/roles and asset count: two users, zero assets.
npx --yes pnpm@10.34.7 db:inspect:dev
# DESTRUCTIVE: removes only this application's core schema/history in the local DB.
npx --yes pnpm@10.34.7 db:reset --confirm=gif_platform
npx --yes pnpm@10.34.7 db:migrate
npx --yes pnpm@10.34.7 db:seed:dev
```

Seed/inspect/reset require **all three** settings from the local `.env`:
`NODE_ENV=development`, `APP_ENV=development`, and
`ALLOW_DEV_DATABASE_COMMANDS=true`. Only `localhost`, loopback, or Compose `db`
and a `gif_platform`/`gif_platform_*` database are accepted. Reset also needs the
exact database name in `--confirm=...`. `NODE_ENV=production` or
`APP_ENV=production` always refuses seed/reset, including the lifecycle test.
The API retains its production runtime mode and never receives seed passwords.
No seed or reset runs at service startup. These guards complement ordinary
production credential separation; do not point local tooling at a production DB.

Copy/change `DEV_UPLOADER_*` and `DEV_REVIEWER_*` only in ignored `.env`.
Emails must be distinct, trimmed lowercase; passwords must be at least 16
characters. The seed creates one UPLOADER and one REVIEWER, with Argon2id
(`m=19456 KiB,t=2,p=1`) and random salts. It never prints credentials or hashes,
never overwrites an existing hash, and refuses conflicting roles. Password
rotation is not a seed rerun; destructive reset is only for disposable data.

Committed Drizzle migrations are append-only. The runner holds a transaction
advisory lock and records SHA-256 checksums in `gif_migrations.history`;
replay preserves data and edited/missing history fails. A failed batch rolls
back DDL and ledger together. Production uses forward migration only; the
explicit rollback SQL is reachable through the guarded development reset.

```sh
# Generate/version the next SQL file after editing schema.ts; review and commit it.
npx --yes pnpm@10.34.7 db:generate
npx --yes pnpm@10.34.7 db:check
```

For a production migration runner with securely injected `DATABASE_URL`, the
built image command is `node packages/db/dist/cli.js migrate`. Do not use
`drizzle-kit push` or a second migrator ledger. No destructive production down
migration is provided.

### Real PostgreSQL integration tests

The isolated test database requires CREATEDB permission and never touches the
application DB. Tests create/drop a uniquely named database ending in `_test`.
An absent URL/opt-in fails instead of skipping. The following local dependency
uses a temporary PostgreSQL data mount and loopback port 55432:

```sh
docker compose -f infra/compose.db-test.yaml up --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test \
  ALLOW_DATABASE_INTEGRATION_TESTS=true \
  npx --yes pnpm@10.34.7 test:integration
docker compose -f infra/compose.db-test.yaml down
```

Integration tests cover all 13 tables, all FKs, unique/CHECK constraints,
Argon2id verification and separated roles, safe migration/seed replay, concurrent
migration runners, changed-history refusal, failed-DDL rollback, generated FTS
queries/updates/GIN planning, append-only audit, production refusal and
reset→migrate→seed. Unit tests cover seven-axis transition guards separately,
including self-review, missing rights/derivatives, stale version, invalid
sequencing and delivery degradation without erasing historical approval.
There are no B02 authentication endpoints or later feature workflows yet.

## Stop, reset and diagnose

```sh
npx --yes pnpm@10.34.7 stop
# Destructive schema reset, guarded and explicitly confirmed:
npx --yes pnpm@10.34.7 db:reset --confirm=gif_platform
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
approval. Drizzle ORM 0.45.4, Drizzle Kit 0.31.11 and Argon2 2.2.2 are pinned for B01; S3 object operations and bucket
provisioning start in B03; FFmpeg starts in B04. Pure domain state guards reserve the later feature boundaries.

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

CI runs the same checks plus PostgreSQL integration, migration drift, Compose,
browser and real failure tests. A configured
workflow is not evidence that a remote CI run passed. Executed B01 results and gaps are in
[docs/implementation/B01-report.md](docs/implementation/B01-report.md).
