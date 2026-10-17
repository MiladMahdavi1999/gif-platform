# GIF Platform — B05

Local modular-monolith development stack: Next.js, Fastify, PostgreSQL 17, MinIO and Caddy, with authenticated direct uploads, durable private receipts, a lease-based private GIF processor and reviewer-only moderation/takedown. **B06 NOT STARTED.**

B00 was merged in [PR #1](https://github.com/MiladMahdavi1999/gif-platform/pull/1).
B01 was merged in [PR #2](https://github.com/MiladMahdavi1999/gif-platform/pull/2).
B02 was merged in [PR #3](https://github.com/MiladMahdavi1999/gif-platform/pull/3).
B03 and B04 were merged in [PR #4](https://github.com/MiladMahdavi1999/gif-platform/pull/4) and [PR #5](https://github.com/MiladMahdavi1999/gif-platform/pull/5).
See [B05 results](docs/implementation/B05-report.md) for current checks and
[B01](docs/implementation/B01-report.md) / [B00](docs/implementation/B00-report.md) for the baselines.

The seven original Phase 03 documents remain unchanged at the repository root;
`Coding-Agent-Handover.md` and `Implementation-Backlog.md` define this task.
Implementation choices remain Provisional. The 13 core tables and pure state
guards exist. Session login, owner receipts and real private S3 uploads are implemented.
The worker decodes and re-encodes GIFs into verified private derivatives. Reviewers can approve, reject and remove assets with audit history. Public search/media delivery and Picker remain unimplemented.

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

All six services must become healthy. The worker's health means its **poll loop is alive**. Database/schema/storage failures are retried and logged as safe dependency failures; inspect the owner receipt for processing outcomes. The first MinIO source build takes
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
built by `pnpm dev`. These tooling commands never start HTTP or processing services. Rebuild that
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
and a `gif_platform`/`gif_platform_*` database are accepted. Query-string
connection overrides are refused. Reset also needs the
exact database name in `--confirm=...`. `NODE_ENV=production` or
`APP_ENV=production` always refuses seed/reset, including the lifecycle test.
The local HTTP API uses development runtime mode and never receives seed passwords.
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
  npx --yes pnpm@10.34.7 test:integration --exclude packages/db/src/uploads.integration.test.ts
docker compose -f infra/compose.db-test.yaml down
```

Integration tests cover all 13 tables, all FKs, unique/CHECK constraints,
Argon2id verification and separated roles, safe migration/seed replay, concurrent
migration runners, changed-history refusal, failed-DDL rollback, generated FTS
queries/updates/GIN planning, append-only audit, production refusal and
reset→migrate→seed. Unit tests cover seven-axis transition guards separately,
including self-review, missing rights/derivatives, stale version, invalid
sequencing and delivery degradation without erasing historical approval.
B02 authentication, B03 private receipts and B04 leased processing use these tables.

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
approval. Drizzle ORM 0.45.4, Drizzle Kit 0.31.11 and Argon2 2.2.2 are pinned for B01; AWS S3 SDK 3.922.0 object operations and bucket
provisioning are implemented in B03; constrained FFmpeg processing is implemented in B04. Pure domain state guards reserve the later feature boundaries.

Web imports only browser-safe contracts. ESLint blocks DB/storage imports into
web and API/web framework imports into worker. Packages compile to ESM with
strict TypeScript. There is no additional monorepo orchestrator or service.

## Managed cloud builds

BuildKit accepts an optional `proxy_ca` secret for the networked Docker build
steps. Ordinary local Docker needs no override. In a managed cloud environment,
use its supplied CA and proxy configuration. Add an **ignored** Compose override
which supplies `build.secrets: [proxy_ca]` for `api`, `web`, `worker`, `storage-init` and `minio`,
and declares `secrets.proxy_ca.file` as the supplied CA bundle path. Pass that
override after `infra/compose.yaml`. Never copy a session CA or credential into
an image or disable TLS verification. This session's exact override invocation
is recorded in [the B00 report](docs/implementation/B00-report.md).

CI runs the same checks plus PostgreSQL integration, migration drift, Compose,
browser and real failure tests. A configured
workflow is not evidence that a remote CI run passed. Executed B01 results and gaps are in
[docs/implementation/B01-report.md](docs/implementation/B01-report.md).

## B02 authentication checkpoint

B02 adds `/login`, sign out, session restoration and a protected `/review` access
check. The public home and dependency health checks remain available anonymously.
Use the two distinct **B01** seed accounts configured in your ignored `.env`;
passwords are never printed. Run `pnpm db:migrate` and `pnpm db:seed:dev` before
signing in. The seed is opt-in development tooling and does not reset an existing
account password. Processing produces private derivatives; a distinct reviewer can inspect and decide in `/review`.

- `POST /api/v1/auth/login`: strict JSON `{email,password}` and exact configured
  `Origin`; returns the user and session-bound CSRF token, sets HttpOnly cookie.
- `GET /api/v1/auth/session`: optional cookie, returns authenticated status and
  user/CSRF only for a currently valid session.
- `POST /api/v1/auth/logout`: requires current cookie, exact `Origin` and
  `X-CSRF-Token`; revokes server-side and clears cookie. No body or `{}` only.
- `GET /api/v1/review`: reviewer-only B02 stub; anonymous 401, uploader 403,
  explicit REVIEWER grant 200. ADMIN has no implicit reviewer delegation.
- `/review` returns those same HTTP statuses through an uncached web route.

The browser uses the Caddy origin, with no cross-origin credentialed CORS.
`PUBLIC_BASE_URL` must be an exact origin (no trailing slash/path). Optional
`CSRF_ORIGIN` must match it. Non-development API runtimes require HTTPS.
The local Compose API explicitly runs in **development** mode for HTTP; the
compiled web and worker images retain their production runtime. HTTPS sessions
always set `Secure`; all session cookies set `HttpOnly; SameSite=Lax; Path=/`,
with no Domain attribute. `SESSION_COOKIE_NAME` defaults to `gif_session` and
`SESSION_TTL_SECONDS` defaults to 86400 (absolute expiry, no sliding renewal).

Provisional retry defaults: 10 attempts per normalized account and 50 per peer IP
per 15 minutes, including successful attempts. `429` includes `Retry-After`.
Buckets are bounded and process-local; restarting the API resets them. Forwarded
IP headers are not trusted, so local Caddy clients share the peer-IP budget.
A distributed limiter and a reviewed trusted-proxy policy are required before
multi-instance internet deployment. No automatic credential retry is performed.

Additional verification:

```sh
pnpm api:generate  # regenerate docs/api/openapi.json from implemented DTOs
pnpm api:check     # drift check, also in CI
# Full stack started, migrated and seeded first:
pnpm test:e2e
node scripts/test-auth-log-hygiene.mjs
```

`pnpm test:integration` now also runs B02 API tests against a real, disposable
PostgreSQL database with B01 migrations/seed (same opt-in/URL requirements as
above). Browser auth tests disable traces/video to keep credentials and session
values out of retained evidence. Never enable authentication request traces or
commit browser storage state. See `docs/implementation/B02-report.md` for actual
local/CI baseline results and Provisional implementation choices. **B06 NOT STARTED.**

## B03 private upload checkpoint

After the clean-clone commands, sign in as the seeded uploader and open
`http://localhost:8080/studio/upload`. Choose your own animated GIF, enter a title
and optional comma-separated tags, affirm upload rights, then select **Upload
privately**. The browser sends a presigned POST directly to `localhost:9000`.
The progress bar measures transfer only; the UI separately confirms real S3 HEAD
verification and the PostgreSQL commit. A completion transport failure can be
retried with the same upload ID without uploading again. A new attempt is explicit.

Open `/studio/assets` for your owner-only receipt list or
`/studio/assets/:assetId` for eight separate state axes. Refresh restores the
receipt from PostgreSQL. Originals have no preview or download link. Expected
final B03 state: `RECEIVED / QUEUED / PRIVATE / INELIGIBLE / NOT_INDEXED / BLOCKED /
NOT_READY / NOT_REQUESTED`. B03 enqueues `READY`, attempt count 0; B04 subsequently claims it.

Implemented endpoints (shared schemas and generated OpenAPI in `docs/api/`):

- `POST /api/v1/uploads`: UPLOADER, exact Origin, session CSRF, strict metadata,
  `Idempotency-Key` (8–128 ASCII letters/digits/underscore/hyphen). Returns 201.
  Same normalized metadata/key reuses the same asset. Changed metadata 409;
  expired key 409. Default policy 600 seconds, file ceiling 20 MiB.
- `POST /api/v1/uploads/:uploadId/complete`: same owner with UPLOADER and CSRF,
  body `{}`. Actual internal S3 HEAD validates size, claimed size and exact GIF
  content type. Receipt, states, unique READY job and audit commit together.
  Returns 202; repeated completion returns current receipt, including after expiry.
  Unreceived expired intent 410, missing object 409, mismatched MIME/size 409,
  oversized file 413. Bytes are not decoded or certified as safe yet.
- `GET /api/v1/me/assets`: authenticated owner list, newest first, 24 items and
  UUID keyset `nextCursor`/`?cursor=`. No arbitrary S3 keys or private URLs returned.
- `GET /api/v1/me/assets/:assetId`: authenticated owner status; another owner
  receives 404. Anonymous owner reads receive 401.

`pnpm dev` runs a one-shot, guarded `storage-init` service before API startup.
It creates two private buckets, removes bucket policies and enables quarantine
versioning. MinIO's `MINIO_API_CORS_ALLOW_ORIGIN` is the exact `PUBLIC_BASE_URL`;
its global CORS setting is used because local MinIO does not implement bucket
CORS configuration. Readiness additionally checks the quarantine bucket and
versioning. No anonymous object reads, source-file proxy or public routes exist.
Both S3 endpoints must be canonical HTTP(S) origins; non-development mode requires
HTTPS. `S3_PUBLIC_ENDPOINT` is used when signing and `S3_INTERNAL_ENDPOINT` for HEAD.

**Provisional safeguard:** migration `0002_upload_receipt_version.sql` adds
`received_version_id`. The receipt pins its HEAD-verified MinIO version and ETag;
a still-valid form replay can create another private version but cannot replace
the version in the durable receipt. B04 consumes this pinned version for every download. B03 itself does not decode media.

**Provisional limit:** 20 new intents per owner per 15 minutes, persisted and
serialized by an owner-row lock across API processes. Existing-key retries do not
consume another intent. Metadata and rights validation happens before storage.
Upload policy bearer fields are short lived; the browser receives the required
access-key identifier and signature, never the secret access key or an S3 client
with permanent credentials. Development bootstrap/API use the configured local
server identity; production least-privilege identity provisioning remains a gap.

For all real PostgreSQL + MinIO integration tests, first start the full stack
and the isolated database dependency, then run with these disposable local values:

```sh
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test \
  ALLOW_DATABASE_INTEGRATION_TESTS=true ALLOW_STORAGE_INTEGRATION_TESTS=true \
  TEST_S3_INTERNAL_ENDPOINT=http://127.0.0.1:9000 \
  TEST_S3_PUBLIC_ENDPOINT=http://localhost:9000 \
  TEST_S3_ACCESS_KEY_ID=local_access_key \
  TEST_S3_SECRET_ACCESS_KEY=local_only_storage_password \
  npx --yes pnpm@10.34.7 test:integration
npx --yes pnpm@10.34.7 test:e2e
```

Use your ignored `.env` values if you changed the local storage credentials.
Tests generate their own GIF bytes and random isolated buckets/databases. Missing
opt-ins or dependencies fail; B03 is not silently skipped. To run only baseline
B01/B02 PostgreSQL tests use the explicit `--exclude` command above. Browser auth
and upload traces/video are disabled so cookies and signed forms are not retained.
CI also retains a credential-free pinned MinIO image artifact for one day to help
reproduce verification when a managed executor cannot build Go dependencies.

There is no automatic approval, publication, search or media delivery. B04 adds private processing only.
Expired/unreferenced objects and old versions stay private; audited retention and
orphan cleanup require a later operational task. **B06 NOT STARTED.**

## B04 private GIF processing

`pnpm db:seed:dev` now explicitly provisions a separate local PostgreSQL worker login from `WORKER_DATABASE_URL` after migrations. Copy the new `.env.example` setting when upgrading an existing local `.env`, then rebuild, migrate and seed using the commands above. Copy the two new `S3_WORKER_*` settings too: local `storage-worker-init` provisions a separate MinIO account restricted to quarantine reads and derivative-prefix reads/writes, with no public-policy, source-write or deletion privileges. Existing B00–B03 SQL history is unchanged; migration 0003 adds derivative versions/frame metadata and a fixed PENDING-only review command. Production worker role provisioning is operator-owned.

The worker claims due jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`, heartbeats token-fenced leases, and recovers expired jobs with at most three attempts. Source GETs include the exact B03 `VersionId` and `IfMatch`. A sanitized animated GIF and first-frame PNG are uploaded conditionally to private content-addressed keys, SHA-256/HEAD checked and committed with states, audit and completed job in one valid-lease transaction. Success means `SUCCEEDED / READY / PENDING`, with visibility PRIVATE, search INELIGIBLE, indexing NOT_INDEXED and API BLOCKED. Owner receipts poll during queued/running/retry states and display real success/failure after refresh, without media URLs.

The pinned worker uses FFmpeg **5.1.9** (`7:5.1.9-0+deb12u1`). Decoder children receive only inherited input/output pipes and a minimal environment. A Linux seccomp constructor denies file opens, network sockets, process creation (threads only), exec and cross-process inspection; hard limits bound address space (1 GiB), CPU (20 seconds), descriptors, process count and core dumps. The worker container is unprivileged, read-only, capability-free, limited to one CPU/1536 MiB/64 tasks and 100 MiB temporary storage. Fixed arguments force GIF/PNG demuxers and pipe-only protocols; no shell or remote URLs. Unsupported sandbox setup fails closed.

Provisional defaults: 20 MiB input/per-output, 4096 per dimension, 16M pixels, 300 frames, 30 seconds duration, 10 seconds per decoder call, 60 seconds per job, 30-second leases and one-second polls. All are validated configuration settings (see `.env.example`). The receipt reports typed terminal errors; storage/infrastructure failures retry with bounded exponential backoff and jitter.

Linux local checks require `cc`, `ffmpeg` and `ffprobe` in `/usr/bin`; `pnpm test` and `pnpm test:integration` compile the decoder boundary and its probe. Full integration requires the existing PostgreSQL/MinIO opt-ins and credentials documented above. The browser suite additionally stops/restarts the real Compose worker and retains private pending/success/failure screenshots. See [B04 report](docs/implementation/B04-report.md) for processing evidence and [B05 report](docs/implementation/B05-report.md) for moderation evidence. **B06 NOT STARTED.**

## B05 reviewer checkpoint

Sign in with the separate configured reviewer account and open `/review`. Only `SUCCEEDED / PENDING` GIFs enter the paginated queue. Open a queue item to inspect metadata, independent states, a static poster and an explicitly requested private GIF animation. No uploaded original is previewed. Approve uses `POLICY_PASSED`; rejection and removal require an action-specific reason, with optional notes up to 2000 characters. This reason taxonomy is a Provisional local choice.

Approval atomically records the decision/audit, increments `row_version`, grants the authorization states and creates `search_documents`; rejection/removal atomically restrict authorization and delete the projection. The technical processing/delivery axes are preserved. Use **Open asset** with the asset ID to inspect a previous decision or remove an approved asset. Decision and audit history remain visible to reviewers. A conflict requires **Reload asset** before another decision. Identical current retries are idempotent; another actor, version or decision conflicts with 409. A reviewer with an uploader grant cannot review their own asset.

Implemented reviewer API routes are `GET /api/v1/review/queue`, `GET /api/v1/review/assets/:assetId`, `GET /api/v1/review/assets/:assetId/media/:variant`, `POST /api/v1/review/assets/:assetId/decision` and `POST /api/v1/review/assets/:assetId/remove`. Media accepts only `DISPLAY_GIF` or `POSTER_PNG`; cookies/role checks, exact derivative versions and checksums protect previews. Writes retain Origin/CSRF checks. Migration 0004 makes moderation decisions append-only; use the existing migration command when upgrading.

Approval grants internal eligibility only at this checkpoint: public gallery/search/media routes remain absent. **B06 NOT STARTED.**

### B06 public discovery and sanitized media origin

`/` searches approved GIF titles/tags and supports exact tag discovery. `/g/:id`
shows eligible detail, pseudonymous creator attribution, static poster and explicit
GIF playback. Reduced-motion preferences never trigger autoplay; keyboard search,
retry, tag links and playback controls are available. Private routes default to
noindex; eligible detail gets canonical/Open Graph metadata from a fresh API read.

Anonymous routes are `GET /api/v1/public/gifs?q=&tag=&limit=24&cursor=`,
`GET /api/v1/public/gifs/:id`, and `GET /media/:assetId/display.gif` or
`poster.png`. Every public read checks all authoritative policy/state gates;
`search_documents` cannot grant access. Search uses PostgreSQL `simple` FTS,
rank/createdAt/id descending and signed query-bound keyset cursors, preserving
PostgreSQL microseconds. The same dataset has stable pages; concurrent approval,
metadata edits or removals can change later pages. No snapshot or universal
multilingual relevance is promised.

Set `PUBLIC_CURSOR_SECRET` to an independent random secret of at least 32 characters
outside development. Keep it stable across API restarts/replicas; rotation invalidates
old cursors with typed 400. `PUBLIC_MEDIA_CACHE_SECONDS` defaults to 30 and accepts
0–30. Media origin verifies both derivative descriptors and the requested exact
private object version, MIME, size, SHA256 and signature before sending bytes,
then checks policy again. It returns no storage URLs or keys. A confirmed missing
or corrupt derivative returns `503 MEDIA_UNAVAILABLE` and records technical
`DEGRADED` with audit; business/moderation axes remain intact. Subsequent reads are
ineligible. Temporary transport failures return 503 without inferring byte loss.
B06 never auto-restores readiness or republishes an asset. Previously downloaded
or cached bytes may remain after removal; fresh origin requests are denied.

Run `pnpm test:integration` with the existing explicit local PostgreSQL/MinIO
configuration for B00–B06, `pnpm test:e2e` for browser coverage, and
`node scripts/test-public-log-hygiene.mjs` after the configured stack is healthy
and seeded for real public-read/takedown/log verification. See
`docs/implementation/B06-report.md` for exact commands, local versus CI evidence
and remaining limits. B07 Picker and SDK work is not started.
