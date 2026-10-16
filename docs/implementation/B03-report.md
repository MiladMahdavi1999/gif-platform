# B03 — Actual S3 direct upload and durable private receipt

Task: B03 only. **B04 NOT STARTED.** Implementation complete; real MinIO/browser
verification and full Actions result pending at the initial PR checkpoint.
No merge or automatic approval/publication is performed.

## Starting point and references

Fetched latest main `7c9dbad`, verified merge commits for B00 PR #1 (`eba9ad6`),
B01 PR #2 (`17335ec`) and B02 PR #3 (`7c9dbad`), then created dedicated branch
`codex/b03-private-direct-upload`. Read all seven Phase 03 documents, inspected
B00–B02 health/auth/schema/domain/storage/web implementations, tests and reports.
All seven original design documents and governance references remain unchanged.

## Changed files and implemented endpoints

- `packages/contracts/src/uploads.ts`, `index.ts`, `docs/api/openapi.json`:
  shared strict upload/receipt DTOs, eight state axes and generated OpenAPI.
- `apps/api/src/uploads.ts`, `app.ts`, `main.ts`: authenticated UPLOADER intent
  and completion, owner read routes, B02 Origin/CSRF integration, safe errors.
- `packages/db/src/uploads.ts`, `index.ts`, `schema.ts` and additive migration
  `0002_upload_receipt_version.sql` with Drizzle snapshot/journal: PostgreSQL
  intents, owner metadata/tags/rights/states, serialized idempotency and budgets,
  transactional receipt + unique READY job + audit. Existing SQL unchanged.
- `packages/storage/src/uploads.ts`, `index.ts`, config, `.env.example`,
  `scripts/provision-storage.mjs`, Compose and Dockerfile: actual AWS SDK S3
  presigned POST, dual endpoints, real HEAD, private buckets, exact MinIO global
  CORS origin, versioning and readiness. AWS SDK 3.922.0 pinned with lockfile.
- `apps/web/app/studio/**`, home/login links and CSS: selection/metadata/rights,
  actual XHR transfer progress, completion retry, accurate status, list/detail
  private receipts, refresh persistence and no preview. Private routes noindex.
- Original independently authored two-frame pixel fixture; contract/config unit,
  real-service integration and Playwright tests. CI retains baseline checks,
  adds all B03 checks and a credential-free pinned MinIO runtime artifact.
- README and MinIO operational notes. Existing database regression assertions
  updated from two migrations to three; all previous test cases retained.

Endpoints:

| Method/path                               | Implemented behavior                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| POST `/api/v1/uploads`                    | UPLOADER + CSRF + idempotency key; 201 signed private intent   |
| POST `/api/v1/uploads/:uploadId/complete` | Owner UPLOADER + CSRF; HEAD then atomic receipt/job/audit; 202 |
| GET `/api/v1/me/assets`                   | Authenticated owner list, 24-row keyset pagination             |
| GET `/api/v1/me/assets/:assetId`          | Authenticated owner detail; cross-owner 404                    |

## Provisional implementation choices

- **Pinned original version:** additive `received_version_id` records the exact
  HEAD-verified MinIO version alongside ETag/size. Still-valid form replay can
  create another private version, but cannot replace the durable receipt's source.
  B04 must use that version ID; no processing code is added here.
- MinIO global `MINIO_API_CORS_ALLOW_ORIGIN` equals the exact configured web
  origin; local MinIO does not implement S3 bucket CORS configuration. CORS does
  not authorize private reads. SDK signs against the browser endpoint and HEADs
  the internal endpoint without rewriting a signed URL.
- Default 600-second policy and 20 MiB ceiling, config validated. Twenty new
  intents per owner per 15 minutes in PostgreSQL, serialized with owner-row lock.
  Existing-key retries do not consume another intent. Changed normalized metadata
  returns 409 rather than silently reusing a different file's receipt.
- Completion holds session/state locks over bounded HEAD IO, then checks the
  database clock again before committing. Expiration is persisted on access;
  received completion replay remains valid after deadline and does not HEAD again.
- Browser keeps retry key/upload ID only in component memory; durable list/detail
  restores from PostgreSQL. Cookies and CSRF/presigned fields are not copied to
  localStorage/sessionStorage. A lost completion response is retryable.
- Local server identity is shared with the guarded provisioning step. Production
  least-privilege identity/bootstrap policy remains deployment work. The required
  S3 access-key identifier appears in signed forms; secret access key never does.
- No body decoding or animation safety claim at receipt time. S3 MIME/size checks
  confirm intake metadata only; animation decoding belongs solely to B04.

## Commands executed and actual initial results

Local Node 24.19.0, pinned pnpm 10.34.7. Workspace-local Corepack shims under
ignored `work/bin` ensure nested pnpm commands use the pinned version.
Network/Docker commands use scoped network-enabled execution.

- `git fetch origin`; `git switch -c codex/b03-private-direct-upload origin/main`:
  PASS, prerequisite merge history verified.
- `pnpm install --frozen-lockfile --store-dir /workspace/gif-platform/work/store`:
  PASS baseline; subsequent dependency add/install pinned AWS SDK and workspace
  test dependencies. Frozen install is also required by CI.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`:
  PASS locally after fixing Link/ref lint findings. **69 unit tests passed**,
  preserving all 58 B00–B02 tests. Production Next build includes studio routes.
- `pnpm api:generate`: PASS; OpenAPI drift check included in final gates/CI.
- `docker compose -f infra/compose.db-test.yaml up -d --wait`: PASS, real
  PostgreSQL 17.6 on local loopback 55432.
- `TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts`:
  PASS, **23 B01/B02 PostgreSQL regression tests**. Initial hard-coded migration
  counts/test migration position were corrected for the additive migration.
- `ffprobe -v error -count_frames -show_entries stream=codec_name,width,height,nb_read_frames -of json work/original.gif`:
  PASS, authored fixture is GIF, 1×1, two decoded frames. This is fixture
  verification, not an implemented processing pipeline.
- Local pinned MinIO source Docker build: BLOCKED by Go download redirect to
  `storage.googleapis.com` returning Forbidden. Official Docker Hub/Quay image
  pulls also unavailable. No network policy bypass attempted. Actual MinIO,
  browser and full-stack verification remain pending at this checkpoint.
- Git diff check confirms the seven original Phase 03 documents are unchanged.

One attempted edit to the newly added production storage HTTPS rule was rejected
by automatic approval review as a potential security weakening. The stricter
rule was retained and production config tests now use HTTPS storage endpoints.
No security exception or owner approval is needed for the retained validation.

## Verification still pending at the initial checkpoint

Full Actions run, real MinIO integration negatives, signed browser POST and
refresh, full-stack baseline failure/lifecycle/log-hygiene checks. These are
**NOT claimed passed** until executed results are recorded below.

## Remaining gaps and risks

Processing, moderation, public search/media and Picker are not implemented.
No automatic approval/publication. Jobs intentionally remain READY/attempts 0;
receipts remain RECEIVED/QUEUED and all distribution axes blocked. Uploaded bytes
are untrusted and quarantined. Old/expired/unreferenced object versions are not
cleaned up; audited retention/orphan cleanup requires a later operational task.
Production storage identity separation, region/provider/legal/retention decisions,
resource quotas and production deployment approval remain outside B03.

Next unstarted task: **B04 NOT STARTED.**
