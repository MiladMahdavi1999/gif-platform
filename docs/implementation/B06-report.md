# B06 — Public search, gallery, detail and policy-gated media origin

Task: B06 only. B07 NOT STARTED. PR remains draft until all required checks pass.

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
  routes default noindex, with no ineligible title/media in their output.
- Existing review derivative loader is exported for shared descriptor validation;
  existing B00–B05 feature behavior and historical SQL remain intact.

## Validation commands and observed results

Local Node 24.19.0, pinned pnpm 10.34.7. The executor's default pnpm is 11.25.0;
`corepack enable --install-directory work/bin` and
`export PATH="$PWD/work/bin:$PATH"` select the pinned shim for nested scripts.
Initial sandbox socket failures were rerun with authorized local socket access.

| Exact command                                                                                                            | Local result                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `git fetch origin main`                                                                                                  | PASS, latest main f57067d                                       |
| `corepack pnpm install --frozen-lockfile`                                                                                | PASS                                                            |
| `pnpm lint`                                                                                                              | PASS                                                            |
| `pnpm typecheck`                                                                                                         | PASS                                                            |
| `pnpm test`                                                                                                              | PASS: 81 tests, 11 files                                        |
| `pnpm build`                                                                                                             | PASS before final test additions                                |
| `pnpm format:check`                                                                                                      | PASS                                                            |
| `pnpm api:check`                                                                                                         | PASS                                                            |
| `pnpm db:check` and `pnpm db:generate`                                                                                   | Pending                                                         |
| `docker compose -f infra/compose.db-test.yaml up -d --wait`                                                              | In progress                                                     |
| `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .` | BLOCKED: Google-hosted Go dependency downloads return Forbidden |

Full MinIO/FFmpeg/Compose browser, security, log-hygiene and lifecycle execution
is pending CI. These are not claimed as local passes. CI workflow extends the
existing required jobs and excludes the new storage-dependent suite only from
the PostgreSQL-only job; the full-stack job must run it without skips.

## Acceptance/security evidence to verify

New real integration coverage: processed/approved title and Unicode tag discovery;
anonymous verified GIF/PNG; recent/ranked pagination with timestamp ties and
microseconds; signed cursor/query/tag validation; every independent axis with
stale projection; pending/rejected/removed/guessed IDs; unsupported originals and
key paths; removal with conditional/range requests; confirmed missing/corrupt
pinned object, missing descriptor, temporary storage outage, one degradation
audit and preserved business axes; removal during storage read/final gate.

New browser coverage: real upload/process/approve to mobile gallery/detail,
keyboard search/open/play, reduced-motion and preference-change pause, actual
image decode, title/tag search, SEO, media retry, immediate takedown, noindex and
no private data, plus loading/empty/error/search retry. Existing B00–B05 suites
remain required. Public runtime log script exercises real approved reads and
removal while checking query/credential/session/CSRF/note/cursor-key hygiene.

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

Next unstarted task: B07. B07 NOT STARTED.

Local real PostgreSQL regression command (PASS: 29 tests, three files):

```sh
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts --exclude packages/db/src/public.integration.test.ts
```
