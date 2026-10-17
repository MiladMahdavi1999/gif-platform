# B07 — Embedded browser Picker and honest Host demo

Task: B07 only. Branch `codex/b07-embedded-browser-picker`, based on fetched
main `fe6b5afd077c09027f64ceaa16ee81a15f2bfa5b`. Its first-parent history confirms
merged PRs #1–#7 (B00–B06); GitHub confirms PR #7 merged. Read all seven Phase 03
references and inspected the B06 read/media policies, contracts, web, tests and CI.
B08 NOT STARTED. No merge or auto-merge is authorized or performed.

Implementation commit `af1adfa6ccc60a9bdb647301da8b99280022a289` passed all required
checks in [run 39023531493](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39023531493).
All steps in both jobs succeeded; none were skipped. The documentation-only
evidence follow-up is also gated on its own current-head checks before the PR
can be marked Ready for Review; see [PR #8 checks](https://github.com/MiladMahdavi1999/gif-platform/pull/8/checks).

## Implementation and changed files

| Files                                                     | Purpose                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/picker.ts`, `index.ts`            | Export the typed reference, result, callback and recoverable error contracts                                                                      |
| `apps/web/app/picker/gif-picker.tsx`                      | Reusable mounted browser dialog, search/pagination, results, preview, selection/cancel, keyboard/focus and truthful states                        |
| `apps/web/app/picker/public-read.ts`                      | B06 schema-validated, uncached anonymous public GETs, bounded timeout, abort and safe reference binding                                           |
| `apps/web/app/picker/picker-session.ts`                   | Synchronous in-flight/settlement guards, fresh validation, cancellation and silent disposal                                                       |
| `apps/web/app/demo/host-picker/page.tsx`, `host-demo.tsx` | `/demo/host-picker` opens Picker, receives typed callbacks, displays an honest reference receipt and terminal callback count                      |
| `apps/web/app/page.tsx`, `style.css`                      | Discoverable demo link and responsive modal styling                                                                                               |
| `apps/web/app/picker/*.test.ts`                           | Unit tests for idempotency, abort, reentrancy, failure/retry and public HTTP safety                                                               |
| `packages/db/src/public.integration.test.ts`              | Real backend integration for eligibility changes/removal, one callback and absence of state writes                                                |
| `tests/e2e/picker.spec.ts`                                | Real upload/process/approve/select/remove flow plus controlled browser state, keyboard, motion and safety tests                                   |
| `tests/e2e/processing.spec.ts`                            | Reuse one authenticated uploader context across its two existing serial cases, leaving their assertions and the application login limits intact   |
| `apps/web/tsconfig.json`, `tsconfig.tools.json`           | Permit explicit source TypeScript imports in no-emit browser/test checking; Next cannot resolve Node-style `.js` imports of these browser sources |
| `.github/workflows/ci.yaml`                               | Include B07 in existing full regression gates and retain B07 browser evidence                                                                     |
| `docs/implementation/B07-report.md`                       | Scope, contract, evidence and limitations                                                                                                         |

Adding the real B07 browser flow consumes one additional seeded uploader login.
The processing suite now shares one context across its two serial checks (the
same pattern already used by moderation), saving one redundant login and keeping
the full suite within the unchanged ten-attempt per-account budget. Each case
still opens a separate page, and suite teardown closes the context on failure.
No authentication rate control or application security behavior was changed.

No new HTTP endpoint, schema migration, package dependency, SDK packaging,
third-party integration, external ingestion or Host send/post functionality.

## Picker and Host callback contract

The component follows technical-spec section 3.4's in-app `onSelect`, `onCancel`,
`onError` callbacks. Mount `GifPicker` to open a new session; unmount on its
terminal callback. Props are captured for that session. The Host maps the two
terminal callbacks to the following discriminated union:

```ts
type GifSelectionReference = {
  id: string;
  kind: 'GIF';
  title: string;
  posterUrl: string;
  displayUrl: string;
};
type PickerResult =
  | { status: 'selected'; reference: GifSelectionReference }
  | { status: 'cancelled' };
interface PickerCallbacks {
  onSelect(reference: GifSelectionReference): void;
  onCancel(): void;
  onError(error: {
    code: 'SEARCH_UNAVAILABLE' | 'SELECTION_UNAVAILABLE' | 'GIF_RESTRICTED';
  }): void;
}
```

At most one terminal callback occurs per open session. A synchronous guard
prevents duplicate events before React updates. Selection settles before calling
the Host; reentrant/throwing Host callbacks cannot create a second result.
`onError` is a recoverable notification per failed read attempt, not a terminal
result; the dialog remains open. Retry does a fresh request. Cancel/Escape during
validation aborts it and wins over late responses. Unmount silently disposes work.

The Host shows **“Selected; no host action performed.”** or
**“Cancelled; no host action performed.”** Selection updates only local React
state and displays the reference as text. No send/post endpoint, simulated
delivery, `sent` success, or Host action telemetry is implemented.

## Accessibility and interaction

Native modal `dialog.showModal()` provides dialog semantics, backdrop and inert
background. Explicit Tab/Shift+Tab wrapping keeps keyboard focus in visible
controls; initial focus goes to labeled search. Cancel and Escape restore the
connected opening control. Cleanup closes the dialog and aborts searches and
selection; React removes event handlers and B06 removes motion listeners.
Effect recreation creates a fresh controller, including React Strict Mode replay.

Search submits with Enter. All buttons support Enter/Space; Select buttons also
support Left/Right, Up/Down based on current grid columns, Home and End. Native
list/button semantics are retained. Named dialog/help/results, status live
regions, alerts, meaningful image alt and pressed playback controls expose state.

Results use B06 `PublicMedia`: sanitized static poster first, explicit Play/Pause,
media failure/retry and reduced-motion instructions. Changing motion preference
returns playback to a poster. Layout uses bounded viewport width/height, scrolling,
wrapping long text and responsive columns. Cancel remains available while checking.

## Security and eligibility

Only existing B06 public list/detail GETs and policy-gated `/media/:id/` aliases
are used. No alternative authorization path or browser database/storage access.
Before callback, a fresh detail GET uses `cache: no-store`, omits credentials,
rejects redirects and has an abortable ten-second budget. The B06 authoritative
SQL gates cover kind, rights, upload, processing, moderation, visibility, search,
indexing, API and technical delivery. The callback uses fresh detail values,
never the stale grid item. A 403/404 gives a generic restricted/unavailable state;
network/503/schema errors stay recoverable and never report selection success.

Shared B06 schemas validate results. Detail identity and both media paths must
match the requested ID. Only same-origin sanitized aliases render; React escapes
titles. No unsafe HTML, original media, storage URLs, object keys/versions,
credentials or private account data. Existing media byte-integrity and final
authorization gates, authentication, Origin, CSRF and framing policies are intact.
There is no new logging or telemetry of reference/query/private data.

## Executed validation

Local Node 24.19.0 / pnpm 10.34.7. The workspace uses a local Corepack/cache/store
because the home directory is read-only. Shell commands needing sockets/network
run with the tool's additional network permission. Setup:

```sh
mkdir -p work/bin
corepack enable --install-directory work/bin
export COREPACK_HOME="$PWD/work/corepack" XDG_CACHE_HOME="$PWD/work/cache"
export PATH="$PWD/work/bin:$PATH"
pnpm install --frozen-lockfile --store-dir work/pnpm-store
```

| Command                                                             | Observed local result                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Frozen install above                                                | PASS                                                                            |
| `pnpm lint`                                                         | PASS                                                                            |
| `pnpm typecheck`                                                    | PASS                                                                            |
| `pnpm build`                                                        | PASS, includes `/demo/host-picker`                                              |
| `pnpm test`                                                         | PASS: 98 tests, 13 files                                                        |
| `pnpm test:e2e tests/e2e/picker.spec.ts --grep-invert 'real owned'` | PASS: 7 Chromium tests against built app, controlled HTTP; not real-storage E2E |
| `pnpm format:check`                                                 | PASS                                                                            |
| `pnpm api:check`                                                    | PASS, no OpenAPI drift                                                          |
| `pnpm db:check`, `pnpm db:generate`                                 | PASS, no schema drift                                                           |
| PostgreSQL-only integration command below                           | PASS: 29 tests, 3 files                                                         |
| Full-stack local MinIO/worker/browser/lifecycle                     | BLOCKED by MinIO build; CI required                                             |
| CI, log hygiene, dependency failures and lifecycle                  | Not run locally; PASS in full-stack CI below                                    |

Local browser command used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
The built app ran on port 3000, with `node work/browser-proxy.mjs` proxying browser
port 8080; the seven committed controlled tests intercept public API/media calls.
This is browser interaction evidence, not a MinIO-backed integration claim.
The real-stack test remains required in CI. Initial unit attempt without socket
permission failed with EPERM; its authorized rerun passed all 98 tests.

Additional executed local commands:

```sh
git diff --exit-code -- packages/db/migrations
docker compose -f infra/compose.db-test.yaml up -d --wait
TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration --exclude packages/db/src/uploads.integration.test.ts --exclude packages/db/src/processing.integration.test.ts --exclude packages/db/src/review.integration.test.ts --exclude packages/db/src/public.integration.test.ts
export BUILDX_CONFIG="$PWD/work/buildx"
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/minio/Dockerfile -t gif-platform-minio:2025-10-15 .
```

PostgreSQL 17.6 start and its 29-test suite passed. MinIO build failed at the Go
build step with Forbidden downloads from `storage.googleapis.com`. The application
was not weakened to bypass this restriction. Full real MinIO/worker/browser,
log-hygiene, dependency-failure and lifecycle checks are therefore CI evidence,
not claimed as local full-stack passes. Build/typecheck also caught a browser/Node
import resolution mismatch; explicit `.ts` imports with no-emit checking fixed it,
and the final build/typecheck passed. These are tooling corrections, not changes
to the architecture references.

The superseded implementation run
[39023127459](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39023127459)
passed 98 unit tests and 75 real integration tests (7 files), including both B07
selection-policy cases. Its browser result was 24 passed / 1 failed: all eight
B07 cases passed, while the final existing upload case hit the seeded uploader's
login budget. Log-hygiene/dependency/lifecycle steps were skipped after that
failure and are not considered passed for this run. The context-reuse correction
above is verified in `af1adfa6ccc60a9bdb647301da8b99280022a289` by the fully passing
run below. No unexecuted, skipped, unavailable or blocked check is
considered passed.

## Completed full-stack CI evidence

Verified implementation head: `af1adfa6ccc60a9bdb647301da8b99280022a289`.
[Full-stack job 117369913008](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39023531493/job/117369913008)
and [PostgreSQL job 117369912860](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39023531493/job/117369912860)
are both SUCCESS. All 46 full-stack and 14 PostgreSQL job steps succeeded,
including setup/cleanup; no required step was skipped.

| Gate                                                                 | Observed CI result                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Frozen install, formatting, lint, typecheck and production build     | PASS                                                                            |
| Unit tests                                                           | PASS: 98 tests, 13 files (81 existing + 17 B07)                                 |
| OpenAPI and database schema/migration drift checks                   | PASS; no generated changes                                                      |
| Real PostgreSQL/MinIO/FFmpeg integration                             | PASS: 75 tests, 7 files (73 existing + 2 B07)                                   |
| Separate PostgreSQL job                                              | PASS: 29 tests, 3 files; repeated subset of the 75, not additional unique cases |
| Playwright Chromium                                                  | PASS: 25 tests (17 existing + 8 B07); no skipped tests                          |
| Auth/upload/review/public runtime log hygiene                        | PASS: all four scripts                                                          |
| Real DB/MinIO/API outage and recovery, detail keyboard retry/noindex | PASS                                                                            |
| Worker SIGTERM, all service logs, fresh-volume reboot                | PASS                                                                            |
| Migration/seed replay, confirmed reset and remigrate/reseed/inspect  | PASS                                                                            |
| Single-origin health/home smoke and final Compose cleanup            | PASS                                                                            |

The [browser/runtime evidence artifact](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39023531493/artifacts/12097528747)
contains B07 mobile/Host screenshots plus all retained B00–B06 browser and checked
runtime-log evidence. Test assertions require one callback, focus restoration,
fresh eligibility denial and zero Host write requests/no sent or posted success.

Selected actual job result lines:

```text
Test Files  13 passed (13)
Tests       98 passed (98)
OpenAPI matches implemented contracts
Test Files  7 passed (7)
Tests       75 passed (75)
25 passed (26.3s)
PASS: db stopped -> readiness 503, liveness 200, browser unavailable
PASS: minio stopped -> readiness 503, liveness 200, browser unavailable
PASS: API stopped -> edge 502, home still renders, browser unavailable
PASS B06: real API outage detail error/noindex and keyboard retry after recovery to truthful not-found
PASS: worker SIGTERM exits 0 and records graceful shutdown
PASS: all six service logs exclude configured credentials/DB URL
PASS: fresh local volumes reboot all six services and readiness 200
```

## Full-stack CI command matrix

The existing full-stack workflow executed the following commands successfully
in the verified implementation run. The PostgreSQL/schema job also
runs the excluded-subset integration command shown above and checks that
migration generation produces neither tracked nor untracked changes.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
sudo apt-get update && sudo apt-get install -y ffmpeg gcc
pnpm test
pnpm api:check
pnpm build
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

Values in these commands are disposable repository-defined local CI credentials,
not production secrets. No external content is downloaded as a GIF fixture.

## Browser smoke steps and observations

Manual reproduction: follow README's stack start/migrate/seed instructions;
upload an owned animation at `/studio/upload`, wait for SUCCEEDED/PENDING, then
approve it as the separate reviewer at `/review`. Open `/demo/host-picker` in an
anonymous browser and execute the steps below. To reproduce removal denial,
keep the result grid open while removing the GIF from the reviewer surface.

Observed local Chromium smoke through the committed browser tests:

1. Open `/demo/host-picker`, Tab/Enter to open: named modal opens, search focused.
2. Type a query/Enter, Tab to first Select, arrow to next/Home, Space: selected
   reference appears once, dialog closes and opening button regains focus.
3. Reopen, click Cancel twice; reopen/Escape twice: one cancellation per opening,
   focus restored and search state reset.
4. Inject delayed/failed/empty/restricted searches: loading, alert/retry and empty
   states are truthful. Inject network failure on fresh detail: no selection until
   successful retry, with the updated authoritative title in the receipt.
5. Escape during delayed validation: cancellation wins, late response ignored;
   reopening works. Unsafe detail media URL: no success.
6. At widths 320/768/1440, dialog/document have no horizontal overflow. Poster
   decodes, explicit playback works and preference changes pause to poster.

The real-stack CI browser also created an owned GIF via the actual signed POST,
waited for worker processing, approved it with a separate reviewer, searched and
selected it through the Picker, and observed one selected callback with no host
write request. It reopened with stale results, removed the GIF through the real
review API, observed restricted selection and 404 detail/media, then cancelled.
The receipt contained the expected ID and no misleading sent/posted success.

Screenshots: `test-results/b07-picker-mobile.png` and
`test-results/b07-host-selected.png`; see the linked CI artifact above. These are automated browser observations, not a claim
of an additional unaided human manual review.

## Limitations and provisional decisions

Browser-only same-document React composition, not an iframe, browser extension,
native SDK, third-party platform integration or external SDK. Modern native-dialog
browsers required; Chromium is the automated target. No cross-browser or formal
assistive-technology audit is claimed. At most the B06 bounded result page is
loaded per request; load-more uses its signed cursor. No trending/ranking changes.

Fresh eligibility is a point-in-time read, not a durable reservation or permission
for a later Host send. Removal can occur after the authoritative read; downloaded
or client-cached bytes cannot be recalled. Actual origin requests still enforce
B06 policy. Future actual Host actions require their own authorization and
eligibility checks. B06 production rights/privacy/retention/identity/capacity gaps
remain. There is no new conflict requiring a Phase 03 reference amendment.

Verified unchanged with `git diff origin/main --exit-code --` against all seven
named root references, `Project-Master-Roadmap.md`, `Project-Decision-Log.md`,
`Project-Status.md` and `packages/db/migrations`; the untracked migration check
and `git diff --check` also passed. No new governance file was added. No actual Host
send/post functionality exists. **B08 NOT STARTED.** B09 NOT STARTED.
