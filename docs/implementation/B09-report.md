# B09 — Staging-ready build package, contract audit and release gate

Status: **technical acceptance and local staging demonstrated; ready for human review after final-head checks.** Production/public-internet launch remains **BLOCKED**. No merge or auto-merge; the 12-phase GIF Platform project is not complete.

## Scope and immutable evidence

Repository `MiladMahdavi1999/gif-platform`; branch `codex/b09-staging-release-gate`. Latest main baseline **91966ed3e67a1a3c141771b5f47726fa34553964** contains merged B08 PR #9 and first-parent B00–B08 PRs #1–#9. GitHub confirmed #9 merged on 2026-10-18. All seven Phase 03 references, exact SL-AC definitions, implemented runtime, CI, contracts, Docker, migration workflow and B08 operational records were inspected before implementation.

Verified implementation/evidence PR head: **b7a108d4fdbe91187de211e35e811c6a9f8d5453**. CI checkout/image source revision: **33113d8887be0c4d9ef365b31cc4323edc69f16d** (GitHub's tested merge checkout; image labels/IDs bind to that immutable tree). [Complete three-job PR run](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39114693205) · [safe staging image/smoke/audit/restore artifact](https://github.com/MiladMahdavi1999/gif-platform/actions/runs/39114693205/artifacts/12131203761) · [retained safe CI excerpts](B09-ci-evidence.txt). The final report/evidence commit necessarily follows this immutable execution checkpoint; the authoritative final branch SHA and final-head checks are visible at [PR #10](https://github.com/MiladMahdavi1999/gif-platform/pull/10) and recorded in the completion response/report. Final-head CI is required before marking Ready for Review; no pending run is a pass.

## Changed files and rationale

| Files                                                                                                                  | Rationale                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/docker/Dockerfile`                                                                                              | Digest-pinned Node stages, source labels, operator script and optional ephemeral build CA support; compiled production runtime and existing sandbox retained.                                                                                                         |
| `infra/minio/Dockerfile`, `health.go`, `provision-worker.go`                                                           | Pinned Go/source provenance, TLS health and explicitly guarded staging IAM; distinct API/Worker storage identities, unchanged development opt-in.                                                                                                                     |
| `infra/staging/compose.yaml`, `Caddyfile`, `Edge.Dockerfile`                                                           | Production-only local HTTPS topology, private backend network, controlled loopback storage ingress, no source mounts or seed, baked config with deterministic permissions, removed inherited low-port file capability so cap-drop/no-new-privileges remain enforced.  |
| `packages/db/src/staging.ts`, `staging.integration.test.ts`                                                            | Explicit idempotent identities/role provisioning, no content seed, lock-only identity privileges with API mutation guards, restoration of processing-function ACLs; six real PostgreSQL tests. No historical migration edits.                                         |
| `scripts/staging.mjs`, `staging-admin.mjs`, `staging-recovery-check.mjs`                                               | Validate/build/provenance, independent infrastructure/migration/provision/bootstrap/start/readiness, safe log gate, quiescent paired backup, fresh-target full-version restore, original/derivative pins and inventory fingerprint, retained audit/revocation checks. |
| `packages/contracts/src/index.ts`, `scripts/generate-openapi.mjs`, `docs/api/openapi.json`, `docs/api/v1/openapi.json` | Deterministic versioned implemented contract, accurate error/status/security/budget/header descriptions and internal/public boundaries; generic documented 500 corrected to runtime 503.                                                                              |
| `apps/api/src/app.ts`, `contract.test.ts`                                                                              | Observe registered operations without an endpoint; compare all GET/implicit HEAD/POST routes to OpenAPI and validate real unavailable-session 503 behavior.                                                                                                           |
| `apps/web/app/picker/gif-picker.tsx`                                                                                   | Acceptance audit found native nonempty search inputs consume Escape. Explicit dialog key handling now cancels once and restores focus for exact SL-AC-10; no new Host action or feature.                                                                              |
| `tests/staging/journey.spec.ts`, `playwright.staging.config.ts`, `tsconfig.tools.json`                                 | Real Chromium lifecycle, typed private failure/new upload, committed-result takedown checks, typed-query Escape, safe transport errors and finite waits; no mocked network, request traces or credential screenshots.                                                 |
| `.github/workflows/ci.yaml`, `scripts/check-test-gates.mjs`, `package.json`                                            | Required independent clean staging/restore job; retain all existing regression gates, reject disabled/conditional test declarations and staging mocks, expose explicit staging commands and safe artifacts.                                                           |
| `README.md`, `docs/implementation/B09-*.md`, `B09-ci-evidence.txt`                                                     | Deployment/bootstrap/migration, smoke, backup/restore/rollback, exact traceability and separate A/B/C release decisions with executed evidence and limits.                                                                                                            |

## Images and staging architecture

Build uses committed-source SHA tags, immutable image IDs, source labels and lockfile SHA256. No external registry push, development bind mount/hot reload, implicit account/content fixture or embedded staging credential. Node/Go/Caddy/PostgreSQL bases are digest-pinned, pnpm/FFmpeg and dependencies are fixed. Build-time proxy CA is a temporary BuildKit mount; runtime TLS uses an injected seven-day local CA, with the CA private key outside containers. Images are reproducible from the pinned workflow; bit-identical layers across builders/timestamps or permanent repository availability are not claimed. Retain tested images by ID for rollback rather than rebuilding.

| Built image                                                            | Immutable ID                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `gif-platform-staging-app:33113d8887be0c4d9ef365b31cc4323edc69f16d`    | `sha256:368c2638be5e7c1d680eed2f3df7aec5710c98f01d16e7e530634249f6c234ba` |
| `gif-platform-staging-worker:33113d8887be0c4d9ef365b31cc4323edc69f16d` | `sha256:d442f986d7b30f4e7064342af3fb18c3b6fa7389f59c7778d264087ffb14ec62` |
| `gif-platform-staging-minio:33113d8887be0c4d9ef365b31cc4323edc69f16d`  | `sha256:a83b20ddf1478861d62151c604b0f3af799fcefc8098ffd8c060ee43bcdb6057` |
| `gif-platform-staging-edge:33113d8887be0c4d9ef365b31cc4323edc69f16d`   | `sha256:d873b6f92dd7ec231a301057ff6808c6a86c986ae9b732ab917d92e1f673482d` |

Pinned PostgreSQL: `postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`; image ID `sha256:567d5d704a3e5a4864393b623a0d50eb1b5a4ad134cdac7cf19555cb2d8ffe9e`. Complete provenance is retained in the linked artifact.

Caddy `127.0.0.1:8443` routes Web/API/media; browser signed POST reaches MinIO TLS at `127.0.0.1:9443`. Edge/MinIO join ingress for those loopback ports; API/Web/Worker/PostgreSQL stay on the internal backend network, with no host ports or Worker egress. MinIO console is unpublished; both versioned buckets remain private. API and Worker use different restricted DB/S3 identities; admin/root credentials belong only to one-shot control-plane jobs. Worker retains non-root/read-only filesystem, capability drop, no-new-privileges, bounded CPU/memory/PIDs/tmpfs and the real decoder sandbox.

API liveness, authenticated dependency readiness, Worker liveness/readiness and infrastructure initialization remain distinct. Start verifies the migration ledger, private versioned storage, processing-function ACL and API identity-mutation guards. PostgreSQL requires column UPDATE privilege for the existing identity row locks; operator-owned guards prohibit API identity updates while credentials/roles stay ungranted. This staging-only provisioning policy is explicit and requires human review; it is not a historical migration change.

## Commands actually executed and results

The linked run executes the committed `.github/workflows/ci.yaml` verbatim. Required steps ran unconditionally; zero test cases were skipped. The failure-only diagnostic step is optional and skipped on success, not a test or acceptance gate.

```sh
pnpm install --frozen-lockfile
node scripts/check-test-gates.mjs
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm api:check
pnpm build
pnpm db:check
pnpm db:generate
pnpm dev
pnpm db:migrate
pnpm db:seed:dev
pnpm db:inspect:dev
pnpm db:reset --confirm=gif_platform
pnpm test:smoke
pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
node scripts/test-auth-log-hygiene.mjs
node scripts/test-upload-log-hygiene.mjs
node scripts/test-review-log-hygiene.mjs
node scripts/test-public-log-hygiene.mjs
node scripts/test-operations.mjs
node scripts/test-dependency-failures.mjs
node scripts/test-local-lifecycle.mjs --confirm=gif_platform
```

The development regression job alone uses the separately guarded development seed/reset and disposable test databases; these are never staging deployment actions. Its exact repetitions, opt-in integration variables, fresh-volume setup and cleanup are in the workflow/run. Schema generation is checked for tracked **and untracked** migration drift.

```sh
pnpm staging init
pnpm staging validate
pnpm staging build
pnpm staging infra
pnpm staging migrate
pnpm staging migrate
pnpm staging empty
pnpm staging provision
# This negative assertion is required to fail, before creating identities:
if pnpm staging bootstrap; then exit 1; fi
pnpm staging bootstrap --authorize-test-identities
pnpm staging bootstrap --authorize-test-identities
pnpm staging start
pnpm staging verify
pnpm staging smoke
pnpm staging logs-check
pnpm staging backup
pnpm staging restore-drill
pnpm staging down
```

`empty` observed zero users/assets/variants/jobs/decisions/audit before explicit bootstrap. Infrastructure was freshly created, migrations and bootstrap were idempotent, missing bootstrap authorization was rejected, production images started and TLS/API/Worker readiness passed. `down` preserves volumes. No implicit destructive reset, dev seed or application-start migration occurs. A failed migration stops deployment; the existing migration runner serializes/checksums/transactions its ledger and DDL, with real tests proving failed-DDL rollback and edited-history rejection.

| Executed gate                                                                  | Count / outcome                            |
| ------------------------------------------------------------------------------ | ------------------------------------------ |
| Frozen install, formatting, lint, typecheck, production build                  | PASS                                       |
| Unit / domain / configuration / contract / decoder                             | 104 / 104 PASS                             |
| Real PostgreSQL/MinIO/FFmpeg/auth/permission/security/recovery integration     | 88 / 88 PASS                               |
| Independent repeated PostgreSQL subset, included in those 88                   | 37 / 37 PASS                               |
| Chromium regression                                                            | 25 / 25 PASS                               |
| Real production-mode staging Chromium journey                                  | 1 / 1 PASS                                 |
| OpenAPI runtime/artifact and schema/migration drift                            | PASS                                       |
| Log hygiene, dependency interruption/recovery, SIGTERM, fresh-volume lifecycle | PASS                                       |
| Clean production-staging boot and explicit bootstrap                           | PASS                                       |
| Paired database/full-versioned-storage restore                                 | PASS in a new disposable project           |
| Cross-release image rollback / production DR                                   | NOT VERIFIED; documented limitations below |

## Real smoke and audit evidence

The actual browser POST, immutable private receipt, real Worker/FFmpeg, private derivative decoding and pending/nonpublic state passed. The uploader's approval request returned 403 without a decision; the separate authorized human-role reviewer approved through the actual UI. Exactly one approval and its actor/audit were persisted; eligible search, Web detail and both sanitized aliases worked. The original stayed private. Signed-form replay created a noncurrent original version without moving the receipt or derivatives.

The Host received exactly `selected`, with **Selected; no host action performed.**, one callback and zero Host write requests. Escape/Cancel, nonempty native-search Escape, focus restoration and real empty results passed. Authorized takedown retained APPROVE/REMOVE and their actor/event history; new public API detail, display/poster origin and stale Picker selection were denied. A fresh Web page showed unavailable/no old title/no media/noindex. Next.js can stream that denied HTML shell with HTTP 200; strict Web transport-404 is not claimed or substituted for the strict API/media 404 checks. Review that framework behavior before public launch.

A static owned GIF then produced typed `MEDIA_NOT_ANIMATED` while staying private; the same uploader completed a distinct valid new upload whose derivatives remained pending/private. No third-party media was fetched. DTO/log checks found no credentials, session/signature values or private object keys/version IDs in shared evidence. Scoped upload-form fields are the authorized private transport, not public metadata.

These are automated interactions using distinct authorized human-role personas, not an actual human policy/legal review. [Smoke checklist and safe artifact schema](B09-smoke.md) and the linked artifact retain synthetic asset/title, derivative hashes, attributed decisions and audit event types. Credential-bearing traces, env/CA private keys, raw backups and complete work directories are excluded.

## Recovery / rollback and executed limits

`backup` stopped ingress/application writers and MinIO, then captured a custom PostgreSQL dump and the complete cold MinIO filesystem, including all versions and internal metadata. Private files stayed outside shared artifacts. `restore-drill` validated hashes, created a fresh random project, streamed the archive as UID 1000 through private host descriptors, restored PostgreSQL atomically with no-owner/no-ACL, re-provisioned least privilege/guards and reran unchanged migrations as a no-op.

Every completed source pin was checked by exact version/ETag/size, every derivative by exact version/size/SHA256, and the complete object-version/delete-marker inventory fingerprint matched. This fixture includes an overwritten/noncurrent original; no deliberate nonempty delete-marker scenario was injected. Authenticated private previews matched original derivative hashes, the same decision actor/action and audit-event trail remained, readiness passed, and removed public origin/detail stayed denied. Source data was never reset; the restored project was stopped with volumes retained until runner disposal.

This demonstrates this release's disposable paired snapshot and restart, not a complete DR guarantee. Cross-vendor/object-copy recovery, external/off-host/encrypted backup operations, numeric RTO/RPO, future schema reversibility, active published-content recovery variants, and a distinct prior/current image rollback pair were not executed. Image rollback is documented only for reviewed compatible schema/job/image combinations. Future migrations use forward-compatible expand/migrate/contract; never edit history or run the development reset to reverse staging. Older backups can lose later takedowns: reconcile post-snapshot rights/moderation decisions before exposing any restored service, or keep it private.

## Local evidence, initial failures and corrections

Local frozen install (workspace pnpm 10.34.7), format/lint/typecheck/build/API drift and 37 real PostgreSQL tests passed. Initial default-sandbox unit execution reported 99 pass/5 fail plus one uncaught loopback EPERM; the authorized network-enabled rerun passed all 104 unchanged assertions. Initial shell production build likewise required the supported networking execution context. These failed attempts were never called passing.

The exact local build entrypoint was `BUILDX_CONFIG=/workspace/gif-platform/work/buildx PATH=/workspace/gif-platform/work/tooling/node_modules/.bin:$PATH pnpm staging build`; the guarded workflow invoked Docker builds with the optional `proxy_ca` BuildKit mount. The exploratory MinIO command was `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" --build-arg SOURCE_REVISION=91966ed3e67a1a3c141771b5f47726fa34553964 -f infra/minio/Dockerfile -t gif-platform-minio:b09-build-probe .` with workspace-local buildx state. These commands are diagnostics, not accepted release images.

The pinned local MinIO build remains blocked by the `google.golang.org/api@v0.230.0` redirect to forbidden `storage.googleapis.com`; no policy bypass, dependency downgrade or substitute runtime was used. Local app/Worker explorations and the high-port Caddy validation are not promoted to complete staging evidence. Independent CI built and exercised the real pinned stack above. The initial local pnpm 11.25.0 mismatch was refused; pnpm 10.34.7 and cache/store were installed under ignored `work/`, with lockfile unchanged.

Early CI attempts exposed and led to fixes for tmpfs quoting, explicit PostgreSQL image acquisition, operator/container UID differences, inherited Caddy file capability, native search Escape and required identity row-lock privileges. An isolated real Chromium probe observed native Escape leaving a nonempty search dialog open; the corrected production Web probe observed one cancellation and restored focus. A disposable real Docker network probe reproduced inaccessible published ports on an internal-only network and working loopback ingress on a normal network; MinIO ingress/readiness now matches browser needs. Test selectors/search completion were made deterministic and Next streaming denial semantics were recorded accurately. All acceptance claims refer to the final verified run, not those superseded attempts.

## Acceptance and release gate

**SL-AC-01 through SL-AC-12: PASS for the local technical slice**, based on executed current-tree integration/browser/staging evidence, with exact requirements, components, tests, smoke evidence and follow-up in [acceptance matrix](B09-acceptance.md). All nine stop-the-line invariants are checked there; no unreviewed/original media, owner approval, duplicate/racy derivatives, false Host action, post-takedown origin access, sensitive leak or unexecuted pass is accepted.

A: First Buildable Slice technical criteria demonstrated, pending human review/formal closure. B: local production-mode staging demonstrated on the clean Linux CI fixture. C: production/public-internet launch remains **BLOCKED** independently of A/B. Required rights, privacy, security, vendor/region/TLS/secret handling, operational/retention/backup/capacity, cache/revocation, human moderation and governance approvals are itemized with owners in [release assessment](B09-release-gate.md). No hosting purchase, registry publication or public deployment occurred.

Provisional human review: local CA/key delivery, loopback/ingress topology, lock-only identity grants/guard triggers, current shared runtime/build-dependency footprint, cold MinIO snapshot portability, capacity/cache settings, Next streamed-not-found status, and future migration/image compatibility. A proposed separate owner governance acceptance is in the release gate; no canonical governance source was changed.

All seven Phase 03 Markdown references, `Project-Master-Roadmap.md`, `Project-Decision-Log.md`, `Project-Status.md`, historical migrations and dependency lockfile remain unchanged against the baseline. No unrelated feature or future phase was started.
