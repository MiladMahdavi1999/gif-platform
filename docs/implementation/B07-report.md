# B07 — Embedded browser Picker and honest Host demo

Task: B07 only. Branch `codex/b07-embedded-browser-picker`, based on fetched
main `fe6b5afd077c09027f64ceaa16ee81a15f2bfa5b`. Its first-parent history confirms
merged PRs #1–#7 (B00–B06); GitHub confirms PR #7 merged. Read all seven Phase 03
references and inspected the B06 read/media policies, contracts, web, tests and CI.
B08 NOT STARTED. No merge or auto-merge is authorized or performed.

Delivery state: implementation complete; final regression/CI evidence pending.
This report will be updated with actual results before marking the PR ready.

## Implementation and changed files

| Files                                                     | Purpose                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/picker.ts`, `index.ts`            | Export the typed reference, result, callback and recoverable error contracts                                                 |
| `apps/web/app/picker/gif-picker.tsx`                      | Reusable mounted browser dialog, search/pagination, results, preview, selection/cancel, keyboard/focus and truthful states   |
| `apps/web/app/picker/public-read.ts`                      | B06 schema-validated, uncached anonymous public GETs, bounded timeout, abort and safe reference binding                      |
| `apps/web/app/picker/picker-session.ts`                   | Synchronous in-flight/settlement guards, fresh validation, cancellation and silent disposal                                  |
| `apps/web/app/demo/host-picker/page.tsx`, `host-demo.tsx` | `/demo/host-picker` opens Picker, receives typed callbacks, displays an honest reference receipt and terminal callback count |
| `apps/web/app/page.tsx`, `style.css`                      | Discoverable demo link and responsive modal styling                                                                          |
| `apps/web/app/picker/*.test.ts`                           | Unit tests for idempotency, abort, reentrancy, failure/retry and public HTTP safety                                          |
| `packages/db/src/public.integration.test.ts`              | Real backend integration for eligibility changes/removal, one callback and absence of state writes                           |
| `tests/e2e/picker.spec.ts`                                | Real upload/process/approve/select/remove flow plus controlled browser state, keyboard, motion and safety tests              |
| `.github/workflows/ci.yaml`                               | Include B07 in existing full regression gates and retain B07 browser evidence                                                |
| `docs/implementation/B07-report.md`                       | Scope, contract, evidence and limitations                                                                                    |

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

## Executed validation and pending gates

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

| Command                                                                 | Observed local result                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Frozen install above                                                    | PASS                                                                            |
| `pnpm lint`                                                             | PASS before final tests; final run pending                                      |
| `pnpm typecheck`                                                        | Pending final run after correcting NodeNext import extensions                   |
| `pnpm build`                                                            | PASS, includes `/demo/host-picker`; final source rebuild pending                |
| `pnpm test`                                                             | PASS: 98 tests, 13 files                                                        |
| `pnpm test:e2e tests/e2e/picker.spec.ts --grep-invert 'real owned'`     | PASS: 7 Chromium tests against built app, controlled HTTP; not real-storage E2E |
| Formatting, OpenAPI/schema drift, PostgreSQL and full-stack regressions | Pending                                                                         |
| CI, log hygiene, dependency failures and lifecycle                      | Pending                                                                         |

Local browser command used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
The built app ran on port 3000, with `node work/browser-proxy.mjs` proxying browser
port 8080; the seven committed controlled tests intercept public API/media calls.
This is browser interaction evidence, not a MinIO-backed integration claim.
The real-stack test remains required in CI. Initial unit attempt without socket
permission failed with EPERM; its authorized rerun passed all 98 tests.

CI links and exact final counts will be recorded here after completion. No
unexecuted, skipped, unavailable or blocked check is considered passed.

## Browser smoke steps and observations

Executed local Chromium smoke through the committed browser tests:

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

Screenshots: `test-results/b07-picker-mobile.png`; real-stack Host screenshot and
CI artifact links pending. These are automated browser observations, not a claim
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

All seven Phase 03 references, governance files and historical migrations must
remain byte-for-byte unchanged; final diff verification pending. No actual Host
send/post functionality exists. **B08 NOT STARTED.** B09 NOT STARTED.
