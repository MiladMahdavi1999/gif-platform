# B00 recovery and verification report

Session date: 2026-10-16 (Asia/Tehran). Scope: **B00 only**.

**Status: B00 implementation and runtime gates verified; ready for human review.**
No architecture or product scope changes. **B01 NOT STARTED.**

## Recovery findings

The checkout at `/workspace/gif-platform` contained only the seven original design
documents. `git status --short --branch` was clean on `work`; `git log`,
`git reflog`, `git stash list` and `git fsck --no-reflogs --unreachable` found no
previous B00 changes or recoverable commit. GitHub showed only `main` at
`156b347cef9f8902c1f97235260a86bc709cdb8d` and no B00 PR. The previous reported
13 tests were not reused as evidence. B00 was rebuilt from the repository docs.

All seven original documents remain byte-identical to the initial commit. Their
root location is preserved; no reference/governance files were moved or edited.

## Delivered files and behavior

- `apps/web`: Next.js home with the required heading and accessible health status,
  polling the same-origin API every five seconds with explicit failure states.
- `apps/api`: only `/api/v1/health/live` and `/api/v1/health/ready`, actual timed
  PostgreSQL `SELECT 1` and MinIO HTTP health checks, 503 on dependency failure,
  no-cache/request-ID headers, sanitized errors and suppressed request logs.
- `apps/worker`: idle heartbeat and clean SIGTERM/SIGINT shutdown; no media jobs.
- `packages/config`, `contracts`, `db`, `storage`: validated configuration, shared
  health DTO and real dependency probes. `domain` and `testing` reserve empty
  boundaries. No product schema or domain operations exist.
- `infra`: six-service Compose, Caddy single-origin routes, healthchecks, named
  volumes, loopback host ports and pinned releases/source. Internal hostnames use
  `NO_PROXY`; the BusyBox loopback healthcheck uses `wget -Y off`.
- Root tooling: exact pnpm/JS pins and lockfile, strict TS, lint/format, Vitest,
  Playwright, CI, failing migration/seed/domain-integration placeholders, README
  and this evidence. CI retains browser screenshots and a checked runtime log.

Provisional compatibility choices are in README. MinIO uses the upstream security
release `RELEASE.2025-10-15T17-29-55Z`, source commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`, built with pinned Go 1.24.8. This
follows upstream instructions after official registry pulls were unavailable;
it preserves the selected MinIO dependency and topology.

## Actual execution evidence

The full runtime checks ran on a **fresh GitHub Actions Ubuntu checkout and
fresh named volumes**, not a mock object store. Verified code/test commit:
`f1d8382fff03bfc05e075e8781602368092b5903`.

- [Full CI including lifecycle verification](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38808669208)
- [Earlier complete bootstrap/browser/failure run](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38807955911)
- Browser/runtime evidence is attached to the CI run as `b00-browser-evidence`.

Local commands used `npx --yes pnpm@10.34.7` because system pnpm was 11.25.0.
CI uses the same pinned pnpm directly. All commands below ran from the repo root.

| Command / gate                                                        | Local execution                                        | GitHub Actions execution                              |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                      | PASS                                                   | PASS                                                  |
| `pnpm format:check`                                                   | PASS                                                   | PASS                                                  |
| `pnpm lint`                                                           | PASS                                                   | PASS                                                  |
| `pnpm typecheck`                                                      | PASS                                                   | PASS                                                  |
| `pnpm test`                                                           | PASS, 18 tests / 3 files                               | PASS, 18 tests / 3 files                              |
| `pnpm build`                                                          | PASS                                                   | PASS                                                  |
| `pnpm audit --prod`                                                   | PASS, no known vulnerabilities reported                | NOT RUN                                               |
| `docker compose --env-file .env -f infra/compose.yaml config --quiet` | PASS                                                   | Covered by actual boot                                |
| App Docker image build                                                | PASS with cloud CA secret                              | PASS via `pnpm dev`                                   |
| MinIO source image build                                              | BLOCKED by local network policy                        | PASS via `pnpm dev`                                   |
| `cp .env.example .env` then `pnpm dev`                                | Full start not verified locally                        | PASS, all six services healthy                        |
| `pnpm test:smoke`                                                     | NOT RUN in full healthy state                          | PASS, home/live/ready through Caddy                   |
| `pnpm exec playwright install --with-deps chromium`                   | System Chromium used instead                           | PASS                                                  |
| `pnpm test:e2e`                                                       | Two failure tests passed using `--grep 'home reports'` | PASS, all 3 tests                                     |
| `node scripts/test-dependency-failures.mjs`                           | Full cycles NOT RUN                                    | PASS, real DB/MinIO/API stops and recoveries          |
| `node scripts/test-local-lifecycle.mjs`                               | Full lifecycle NOT RUN                                 | PASS, worker exit 0, log hygiene, fresh-volume reboot |
| `pnpm stop`                                                           | PASS on diagnostic five-service stack                  | PASS full-stack equivalent Compose down               |
| `docker compose --env-file .env -f infra/compose.yaml down --volumes` | PASS on disposable diagnostic volumes                  | PASS, followed by healthy reboot                      |
| `pnpm db:migrate`, `pnpm db:seed:dev`, `pnpm test:integration`        | Expected exit 1 with NOT IMPLEMENTED                   | NOT RUN; no domain integration pass claimed           |
| `git diff --check` and original document comparison                   | PASS                                                   | Not separately claimed                                |

Observed assertions from the full real-service CI tests:

1. Caddy `/` renders `GIF Platform — local development`; browser reports both
   dependencies ready. Liveness and readiness return HTTP 200.
2. Stop PostgreSQL: readiness 503 with only DB down; liveness 200 and browser
   unavailable. Restore PostgreSQL: readiness 200 and browser ready.
3. Stop MinIO: readiness 503 with only storage down; liveness 200 and browser
   unavailable. Restore MinIO: readiness 200 and browser ready.
4. Stop API: edge returns 502, home remains HTTP 200, browser says API unavailable.
   Restore API: readiness 200 and browser ready.
5. Worker SIGTERM exits 0 and records `stopped`. All six runtime service logs
   exclude configured DB/storage credentials and full DATABASE_URL.
6. Delete this Compose project's disposable volumes, reboot all six services from
   built images, and repeat ingress home/live/ready smoke: PASS.

Vitest covers config defaults/invalid values/safe errors, independent dependency
failures, liveness separation, no product routes and actual local HTTP responses
for the storage probe. Playwright's two intercepted-error tests are distinguished
from the real dependency stop/recovery script above.

## Local environment limitation

The recovery executor could build the app image and run PostgreSQL, API, web,
worker and Caddy, but its policy denied `storage.googleapis.com`, a redirect
host for some Go module ZIP downloads. Therefore the MinIO source build failed
locally with HTTP 403/Forbidden. Full healthy runtime results above come from
GitHub Actions, whose actual logs and completed steps were inspected. This is
not presented as a successful six-service run in the local executor.

Local partial-stack probes independently verified truthful `storage: down`
readiness 503, actual PostgreSQL stop/restore, API stop to 502 with browser error,
worker shutdown, and no secrets in those five services' logs. No recovery-to-200
claim is made for that incomplete local stack. Diagnostic containers and volumes
were shut down/reset after collecting evidence.

The ignored `work/compose.cloud.yaml` supplies `proxy_ca` from
`${CODEX_PROXY_CERT}` as a BuildKit secret to each app and MinIO. Commands used:

```sh
docker compose --env-file .env -f infra/compose.yaml -f work/compose.cloud.yaml build api
docker compose --env-file .env -f infra/compose.yaml -f work/compose.cloud.yaml build minio
```

The first passed; the second hit the policy denial. Ordinary local Docker and
GitHub Actions need no override. TLS verification stays enabled; no session CA or
credentials are baked into images. The local executor would need that host added
to Allowed Hosts to repeat the full source build there.

## Review boundary

No schema, migrations, seed, auth, upload, public storage/buckets, moderation,
search, picker or media processing exists. Unimplemented commands fail explicitly.
Container tags are exact versions rather than immutable digests; ESLint 9.39.5 is
marked deprecated but matches the Next plugins' supported peer range. Production
hosting/storage/security hardening is outside B00. See
[known-gaps.md](known-gaps.md) for remaining local/tooling limitations.

**B01 NOT STARTED.** Human review/merge remains the next action.
