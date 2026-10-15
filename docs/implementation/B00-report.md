# B00 recovery and verification report

Session date: 2026-10-16 (Asia/Tehran). Scope: **B00 only**.

**Status: implementation prepared; full B00 acceptance BLOCKED by the managed
environment's network policy. This is not a completed/accepted B00.**

## Recovery findings

The recovery checkout at `/workspace/gif-platform` contained only the seven
original design documents. `git status --short --branch` was clean on `work`;
`git log`, `git reflog`, `git stash list` and `git fsck --no-reflogs --unreachable`
found no prior B00 implementation or recoverable commit. The GitHub branches API
showed only `main` at `156b347cef9f8902c1f97235260a86bc709cdb8d`; a search for B00
PRs returned none. The prior reported 13 tests were therefore **not reused as
evidence**. B00 was rebuilt from the repository's handover/backlog.

All seven original documents were checked byte-for-byte against the initial
commit and remain unchanged. Their root location is retained to avoid moving or
duplicating reference files. No governance document or architecture was changed.

## Implementation

- `apps/web`: Next.js home with the required heading and a polling, accessible
  dependency status. Failure, invalid response and unreachable API are explicit.
- `apps/api`: only versioned liveness/readiness routes, request IDs, no-cache
  responses and sanitized failures. Liveness never asserts dependency health.
- `apps/worker`: idle heartbeat and graceful shutdown, explicitly no media jobs.
- `packages/config`, `contracts`, `db`, `storage`: validated settings, health DTO,
  actual timed PostgreSQL query and MinIO HTTP readiness probe. `domain` and
  `testing` reserve empty package boundaries. No schema or domain logic exists.
- `infra`: six-service Compose, healthchecks, named volumes, Caddy routing,
  loopback-only published ports and pinned source/image releases. Internal
  service names bypass only the outbound HTTP proxy using `NO_PROXY`; BusyBox's
  loopback healthcheck explicitly uses `wget -Y off`.
- Root tooling: exact pnpm/dependency pins and lockfile, strict TypeScript, lint,
  formatting, Vitest, Playwright, CI and explicit failing migration/seed/domain
  integration placeholders. README documents one full Compose startup path.

Version/compatibility choices are recorded in README. Provisional implementation
detail: official MinIO images were unavailable, so Compose builds the upstream
security release from its exact commit. The topology still uses local MinIO.

## Executed gates

Commands below ran in the repository root. `npx --yes pnpm@10.34.7` selects the
pinned version because the environment's preinstalled pnpm was 11.25.0.

| Command                                                                                                       | Observed result                                                      |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `node --version`                                                                                              | `v24.19.0`                                                           |
| `npx --yes pnpm@10.34.7 install --frozen-lockfile`                                                            | PASS; lockfile up to date                                            |
| `npx --yes pnpm@10.34.7 format:check`                                                                         | PASS                                                                 |
| `npx --yes pnpm@10.34.7 lint`                                                                                 | PASS on pinned ESLint 9.39.5                                         |
| `npx --yes pnpm@10.34.7 typecheck`                                                                            | PASS; all packages/apps and test/config TS                           |
| `npx --yes pnpm@10.34.7 test`                                                                                 | PASS; **18 tests across 3 files**                                    |
| `npx --yes pnpm@10.34.7 build`                                                                                | PASS; API, worker, packages and Next static home                     |
| `npx --yes pnpm@10.34.7 audit --prod`                                                                         | PASS; no known vulnerabilities reported                              |
| `docker compose --env-file .env -f infra/compose.yaml config --quiet`                                         | PASS                                                                 |
| `docker compose --env-file .env -f infra/compose.yaml -f work/compose.cloud.yaml build api`                   | PASS; all app/package builds inside Docker                           |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx --yes pnpm@10.34.7 test:e2e --grep 'home reports'` | PASS; **2 browser tests**, intercepted 503 and unreachable API       |
| `npx --yes pnpm@10.34.7 db:migrate`                                                                           | EXPECTED exit 1, NOT IMPLEMENTED                                     |
| `npx --yes pnpm@10.34.7 db:seed:dev`                                                                          | EXPECTED exit 1, NOT IMPLEMENTED                                     |
| `npx --yes pnpm@10.34.7 test:integration`                                                                     | EXPECTED exit 1, NOT IMPLEMENTED; no domain integration pass claimed |
| `git diff --check`                                                                                            | PASS                                                                 |

Unit coverage includes independent dependency failures, liveness separation,
no secret leakage, no product routes, configuration failure/defaults/URL guards,
and actual local HTTP responses for the storage probe. The first unit run caught
an invalid-URL refinement throwing outside validation; it was fixed before the
recorded passing run. Initial browser checks exposed the internal proxy routing
issue; they were rerun after the Compose correction.

The ignored cloud override supplies the platform CA using BuildKit secrets for
each app and MinIO (`secrets.proxy_ca.file: ${CODEX_PROXY_CERT}`). It contains no
credentials and is not committed. Networked build steps retain TLS verification;
the CA is not baked into images. Ordinary local builds need no override.

## Real partial-stack observations

Because MinIO could not be built, diagnostic commands explicitly started only
`db`, `web`, `worker`, then `api` without dependency startup, then the already
created edge container. This is a diagnostic setup, **not a successful execution
of the documented full-stack boot path**.

Commands used included:

```sh
docker compose --env-file .env -f infra/compose.yaml up -d db web worker
docker compose --env-file .env -f infra/compose.yaml up -d --no-deps api web
docker compose --env-file .env -f infra/compose.yaml up -d --no-deps edge
curl --silent --show-error --include http://localhost:8080/api/v1/health/live
curl --silent --show-error --include http://localhost:8080/api/v1/health/ready
docker compose --env-file .env -f infra/compose.yaml stop db
docker compose --env-file .env -f infra/compose.yaml start db
docker compose --env-file .env -f infra/compose.yaml stop api
docker start gif-platform-b00-api-1
docker compose --env-file .env -f infra/compose.yaml stop worker
docker inspect --format '{{.State.ExitCode}}' gif-platform-b00-worker-1
docker compose --env-file .env -f infra/compose.yaml start worker
```

An ad hoc Playwright/HTTP probe (`node work/partial-smoke.mjs`, not a CI gate)
checked the real page and the failure transitions. Observed assertions:

- Home renders the required heading through Caddy. With MinIO absent, browser
  says **Dependencies unavailable**, live is 200, and ready is 503 with
  `database: up, storage: down`.
- Stopping real PostgreSQL changes the DB check to `down`; readiness stays 503
  and liveness stays 200. Restoring it changes DB back to `up`. Readiness still
  stays 503 because storage is absent. **No recovery-to-200 claim is made.**
- Stopping API produces edge 502 while home remains HTTP 200. Browser changes
  to **API unavailable or health response invalid**. Restarting API returns to
  the real unavailable-storage state.
- Worker SIGTERM exits 0, emits `stopped`, and restarts with an idle heartbeat.
- Runtime logs were scanned against configured DB password, S3 secret and full
  DATABASE_URL; none appeared. Worker explicitly says no jobs are implemented.

The partial probe initially tried `compose start api`, which refused the absent
MinIO dependency. Diagnostic restoration used `docker start` on the existing API
container. Full-stack recovery remains unverified.

## Blocker and tests not passed

`docker pull minio/minio:RELEASE.2025-09-07T16-13-09Z` and a second official release
tag failed with `pull access denied ... requested access to the resource is
denied`; the Quay image attempt returned `unauthorized`.

The implementation follows upstream's source-build instructions for
`RELEASE.2025-10-15T17-29-55Z` at
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`. The actual command:

```sh
docker compose --env-file .env -f infra/compose.yaml -f work/compose.cloud.yaml build minio
```

failed during `go build` because Go module ZIP downloads redirected to
`https://storage.googleapis.com/...` and received **Forbidden**. A direct proxy
CONNECT check of that host also returned HTTP 403. No TLS or network-policy
bypass was used. Request: add `storage.googleapis.com` to the managed
environment's Allowed Hosts and apply the change, then rerun the build. An
allowed alternate Go mirror was checked but itself returned 403.

| Remaining gate                                                                  | Actual status                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| MinIO image build and runtime healthcheck                                       | BLOCKED; build attempted and failed at network download |
| Six-service clean checkout/full Compose start                                   | NOT VERIFIED                                            |
| Real ready 200 with PostgreSQL **and** MinIO up                                 | NOT RUN                                                 |
| Healthy-home browser test (first Playwright test)                               | NOT RUN                                                 |
| `npx --yes pnpm@10.34.7 test:smoke` expecting full readiness                    | NOT RUN                                                 |
| `node scripts/test-dependency-failures.mjs` full healthy→failure→healthy cycles | NOT RUN                                                 |
| Stop/restore real MinIO                                                         | NOT RUN                                                 |
| Full-stack shutdown/reset/reboot with fresh volumes                             | NOT VERIFIED                                            |
| Remote GitHub Actions run                                                       | Not claimed passed                                      |

After network recovery, build MinIO, stop the diagnostic stack, run the README
path with fresh disposable volumes, run all three Playwright tests and the
committed dependency-failure script, inspect shutdown/logs, and update this
report. Keep the PR draft until these gates are actually verified.

**B01 NOT STARTED.** No migrations, schema, auth, upload, moderation, search,
picker, S3 object operations or media processing were implemented.
