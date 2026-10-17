# B06 — Public search, gallery, detail and policy-gated media origin

Task: B06 only. All implementation checks passed. Readiness is gated on
completed checks for the PR head, including its documentation/evidence follow-up.
B07 NOT STARTED.

## Baseline and scope

Started from latest fetched main `f57067dd3769a2d044ce654621be2fae0ba77dfb`
(merged PR #6/B05). GitHub metadata confirmed PRs #1–#6 merged, respectively
B00–B05. Dedicated branch: `codex/b06-public-discovery`. Read all seven Phase 03
references and inspected API, domain guards, moderation, search projection, DB
schema/migrations, storage identities/adapters, web, tests, CI and lifecycle scripts.
The seven reference documents and governance files are unchanged. No schema
migration, B07 Picker, SDK, later backlog work, merge or auto-merge is included.

## Implementation

- Shared validated public list/detail/query DTOs and generated OpenAPI 3.1.
- Anonymous list/detail enforce GIF kind, rights v1, received upload, successful
  processing, approved moderation, public visibility, eligible search, indexed
  projection state, enabled API and ready technical delivery in SQL on every read.
- PostgreSQL simple FTS plus exact normalized tag discovery. Deterministic
  rank/createdAt/id descending keyset pagination uses HMAC-signed query-bound
  cursors with exact PostgreSQL microseconds and float4 rank comparisons.
- Media aliases accept only display.gif/poster.png. Both current derivative
  descriptors must be valid. B05's bounded exact-version checksum-verifying
  derivative reader is reused; public reads additionally verify file signatures.
  No original source bucket read, redirect, signed GET, arbitrary key, raw key,
  version or account email is returned. Policy is checked again after storage IO.
- Successful media sends MIME, length, verified SHA256 ETag, nosniff, same-origin
  resource policy, sandbox CSP and configurable public max-age 0–30 with
  must-revalidate. Errors and API metadata use no-store. Conditional/range
  headers cannot bypass authorization; no cached 304 shortcut is implemented.
- Confirmed missing/corrupt derivative or descriptor returns typed 503
  MEDIA_UNAVAILABLE. Asset-first transactional locks and observed descriptor
  comparison conditionally record only delivery DEGRADED, row version and one
  append-only audit event. Approval, processing, search history and other axes
  stay independent. Transport outages do not assert confirmed missing bytes.
- Public responsive gallery/search and server-read detail use HTTP contracts.
  Static posters, explicit play/pause, preference-change pause, keyboard controls,
  meaningful alt, accessible loading/empty/error/retry, tags and copy-link controls.
  Eligible detail receives canonical/Open Graph/Twitter metadata; private/error
  routes default noindex, with no ineligible title/media in their output. Long
  unbroken titles wrap within mobile layouts.
- Existing review derivative loader is exported for shared descriptor validation;
  existing B00–B05 feature behavior and historical SQL remain intact.

## Recovery and remaining work completed

Recovered the existing Draft PR #7 and all four pushed B06 commits through
`54b0a4c2cd31c669734e424c45fd5c8d65387675`. The restored workspace was clean on
B05; no uncommitted B06 files survived the environment restoration. The remote
branch was reused without replacing any implementation or creating another PR.

The prior [CI run 38965640876](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/38965640876)
passed 81 unit tests and all 73 PostgreSQL/MinIO/FFmpeg integration tests, including
11 B06 cases. Browser results were 16 passed / 1 failed: the media-error UI did not appear
after an injected image request failure. Log-hygiene and lifecycle steps were skipped after
that failure and were not considered passed.

Resumed work isolates the media-error browser test in a fresh anonymous context
and asserts an actual aborted request plus successful decoded-image retry.
A controlled local HTTP reproduction established that an SSR image can already
have failed before hydration attaches onError. The media component now checks
for an already completed, undecodable image when its DOM ref attaches. CI
restarts the API between the browser and runtime-log phases so the expanded suite
cannot exhaust the seeded account's login budget before an independent check.
The application authentication limits are unchanged; restarting the same container
retains its logs. A real local outage smoke also found that detail's boundary reset
reused a failed server render. The retry button now requests fresh server data,
with a real stop/recover/keyboard-retry regression in the dependency-failure script.

## Validation commands and observed results

Local Node 24.19.0 and pinned pnpm 10.34.7. The executor's default pnpm is 11.25.0;
`corepack enable --install-directory work/bin` and
`export PATH="$PWD/work/bin:$PATH"` select the pinned shim for nested scripts.
Socket-dependent checks ran with authorized local socket access.

| Exact command                                               | Local result on resumed branch          |
| ----------------------------------------------------------- | --------------------------------------- |
| `pnpm install --frozen-lockfile`                            | PASS                                    |
| `pnpm format:check`                                         | PASS                                    |
| `pnpm lint`                                                 | PASS                                    |
| `pnpm typecheck`                                            | PASS                                    |
| `pnpm build`                                                | PASS, including the detail retry change |
| `pnpm test`                                                 | PASS: 81 tests, 11 files                |
| `pnpm api:check`                                            | PASS, generated OpenAPI matches         |
| `pnpm db:check`                                             | PASS                                    |
| `pnpm db:generate`                                          | PASS, no schema changes                 |
| `git diff --exit-code -- packages/db/migrations`            | PASS                                    |
| `docker compose -f infra/compose.db-test.yaml up -d --wait` | PASS, PostgreSQL 17.6 healthy           |
| PostgreSQL-only integration command below                   | PASS: 29 tests, three files             |

```sh
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts --exclude packages/db/src/public.integration.test.ts
```

The earlier local MinIO build command
`docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .`
was blocked by Google-hosted Go dependency downloads returning Forbidden. That
network policy is still restricted on resume; a blocked build is not reported as
passed. Real MinIO/full worker, full browser, security/log-hygiene and lifecycle
checks are verified in CI, not claimed as local full-stack results.

The local Chromium outage/recovery smoke passed on the rebuilt app: unavailable
API produced a truthful detail error and noindex; restoring the actual API and
pressing Enter on Retry detail fetched new data and rendered unknown/not-found.
The same scenario is committed in `node scripts/test-dependency-failures.mjs` for
reproducible full-stack CI coverage. A separate local Chromium component smoke
with controlled HTTP responses also passed pre-hydration image failure detection
and keyboard retry to a decoded poster; this is UI evidence, not a real MinIO
integration result. Its durable regression is `tests/e2e/public.spec.ts`.
The long-title/keyboard browser test also passed locally with controlled HTTP;
its assertions wait for the submitted query and completed results before focusing
and opening the link. These temporary diagnostic commands all passed:

```sh
node work/detail-recovery-smoke.mjs
node work/media-failure-smoke.mjs
node work/browser-layout-smoke.mjs
```

`work/` diagnostics are local scratch files, not shipped tests; the durable
regressions are the committed browser suite and dependency-failure script.

## Completed CI verification

Verified implementation commit: `8a736459b103df3203ccdd6cb6c53547e6b6f51a`.
Both jobs in [run 39016552786](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39016552786)
completed successfully. No required check was skipped. The delivery follow-up
changes documentation/evidence only; its current checks are visible on
[PR #7](https://github.com/MiladMahdavi1999/gif-platform/pull/7/checks).

| Check                                                                | CI result                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Frozen install, format, lint, typecheck, build                       | PASS                                                                              |
| `pnpm test`                                                          | PASS: 81 tests, 11 files                                                          |
| `pnpm api:check`                                                     | PASS, no OpenAPI drift                                                            |
| `pnpm db:check`, `pnpm db:generate`, migration diff/untracked checks | PASS, no schema drift                                                             |
| `pnpm test:integration` with real PostgreSQL/MinIO/FFmpeg            | PASS: 73 tests, 7 files, including 11 B06 cases and all B00–B05 regressions       |
| Separate PostgreSQL/schema job                                       | PASS: 29 tests, 3 files; these repeat a subset of the 73, not 29 additional cases |
| `pnpm test:e2e`                                                      | PASS: all 17 Chromium tests                                                       |
| All four runtime log-hygiene scripts                                 | PASS                                                                              |
| Dependency stop/recovery and detail keyboard retry                   | PASS                                                                              |
| Worker shutdown, checked service logs, fresh-volume lifecycle        | PASS                                                                              |
| Migration/seed replay, confirmed reset, remigrate/reseed/inspect     | PASS                                                                              |

Exact full-stack commands in addition to the local checks above:

```sh
cp .env.example .env
pnpm dev
pnpm db:migrate
pnpm db:seed:dev
pnpm db:migrate
pnpm db:seed:dev
pnpm db:inspect:dev
pnpm db:reset --confirm=gif_platform
pnpm db:migrate
pnpm db:seed:dev
pnpm db:inspect:dev
pnpm test:smoke
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true ALLOW_STORAGE_INTEGRATION_TESTS=true TEST_S3_ACCESS_KEY_ID=local_access_key TEST_S3_SECRET_ACCESS_KEY=local_only_storage_password TEST_S3_INTERNAL_ENDPOINT=http://127.0.0.1:9000 TEST_S3_PUBLIC_ENDPOINT=http://localhost:9000 pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
docker compose --env-file .env -f infra/compose.yaml restart api
docker compose --env-file .env -f infra/compose.yaml up -d --no-deps --no-build --wait api
pnpm test:smoke
node scripts/test-auth-log-hygiene.mjs
node scripts/test-upload-log-hygiene.mjs
node scripts/test-review-log-hygiene.mjs
node scripts/test-public-log-hygiene.mjs
node scripts/test-dependency-failures.mjs
node scripts/test-local-lifecycle.mjs --confirm=gif_platform
pnpm db:migrate
pnpm db:seed:dev
pnpm db:inspect:dev
docker compose --env-file .env -f infra/compose.yaml down
```

The credentials in that integration command are the repository's disposable local
CI placeholders, not production credentials. The workflow installs pinned tooling,
FFmpeg/GCC, and runs generated-schema drift checks in the separate PostgreSQL job.
See [retained CI evidence](B06-ci-evidence.txt) for selected result lines and exact
job links, and the [browser/runtime artifact](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39016552786/artifacts/12095600256)
for screenshots and the checked runtime log.

## Acceptance and security verification

Passing real integration coverage: processed/approved title and Unicode tag discovery;
anonymous verified GIF/PNG; recent/ranked pagination with timestamp ties and
microseconds; signed cursor/query/tag validation; every independent axis with
stale projection; pending/rejected/removed/guessed IDs; unsupported originals and
key paths; removal with conditional/range requests; confirmed missing/corrupt
pinned object, missing descriptor, temporary storage outage, one degradation
audit and preserved business axes; removal during storage read/final gate.

Passing browser coverage: real upload/process/approve to mobile gallery/detail,
keyboard search/open/play, reduced-motion and preference-change pause, actual
image decode, title/tag search, SEO, media retry, immediate takedown, noindex and
no private data, plus loading/empty/error/search retry. Existing B00–B05 suites
remain required. Public runtime log script exercises real approved reads and
removal while checking query/credential/session/CSRF/note/cursor-key hygiene.

## Security, privacy and takedown conclusions

| Boundary              | Observed verification                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Query-time policy     | Each independent gate, GIF kind and rights version tested against a stale search projection; ineligible rows excluded from list/detail/origin                                                                      |
| Direct media/takedown | Pending, rejected, removed and guessed IDs denied; conditional/range headers cannot bypass denial; removal during storage IO wins the final response gate                                                          |
| Storage privacy       | Original aliases/key paths denied; private MinIO original/version reads denied by existing real-storage regression tests; public DTOs contain no object keys, versions, source URLs, credentials or account emails |
| Derivative integrity  | GIF/PNG exact versions, MIME, size, SHA256, signatures and security/cache headers checked; no redirect or raw storage URL                                                                                          |
| Technical loss        | Missing pinned object, corrupt object and missing descriptor return typed 503; only technical readiness/version/audit change; approval/business states and projection history preserved                            |
| Temporary outage      | Transport failure returns typed 503 without inventing permanent byte loss or publishing content                                                                                                                    |
| Logs and audit        | Actual query, cursor secret, session/CSRF, private note, upload signature, object key, decoder/temp-path and configured credential checks passed; moderation history remains append-only                           |
| Browser/SEO           | Poster-first and explicit playback, reduced-motion preference changes, keyboard search/open/play/retry, mobile wrapping, empty/error/loading, eligible metadata and private/removed/error noindex passed           |

The successful scripted smoke exercised a real owned upload, processing, approval,
anonymous public search/detail/GIF/PNG, then removal and immediate origin/API 404
including conditional/range requests. Dependency checks also stopped/restored DB,
MinIO and API, proving truthful failures and detail recovery. All B00–B05 checks
remained green with the implemented public module enabled in media regressions.

Manual review path: start/seed the documented stack; upload an owned animation at
`/studio/upload`; wait for SUCCEEDED/PENDING; approve from a distinct reviewer at
`/review`; search title/tag on `/`, open `/g/:id` by keyboard, inspect static poster,
explicit playback, attribution and metadata; remove it from review; refresh public
search/detail and GET both origin aliases to observe exclusion/404. Cached bytes
are subject to the limitation below. These paths are also automated in CI.

## Provisional choices and limitations

Creator profiles/display names do not exist in B00–B05. Public attribution is a
stable pseudonymous label from creator ID; account emails are never substituted.
Search is keyword/tag-based simple FTS, without stemming/typo/locale guarantees.
Stable cursors guarantee deterministic pages for a constant dataset, not a
snapshot across edits/approvals/removals. Secret rotation invalidates cursors.

At most 20 MiB of verified requested derivative bytes are buffered before send,
so corrupt or truncated bytes cannot escape in a partially successful response.
This bounds each read but is not a high-throughput/CDN design or a production
capacity guarantee. A request can race removal after its final authorization
check; already transmitted/downloaded/client-cached bytes cannot be recalled.
No CDN/global cache purge or automatic technical recovery is claimed. Missing
bytes first return 503; once confirmed DEGRADED, later public reads return 404.
Production storage identities, retention/cleanup, decoder patch maintenance,
rights/legal review and deployment provisioning remain inherited limitations.

No unresolved B06 acceptance blocker remains. The local MinIO build restriction
and the inherited production/operational limits above are explicitly retained.
All seven Phase 03 references, governance files and historical SQL migrations
were verified unchanged with `git diff origin/main --exit-code --` against the
seven named root reference files and `packages/db/migrations`.

Next unstarted task: B07. B07 NOT STARTED.
