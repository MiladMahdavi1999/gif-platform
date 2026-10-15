# First Buildable Slice — End-to-End GIF Supply → Discovery → Selection

**Document:** P3-SLICE-01 | **Version:** 0.1 | **Status:** Recommended / Provisional engineering slice | **Date:** 2026-10-15

## 1. Decision / why this slice

**Selected first executable vertical slice:**

> **Login (uploader) → Upload one existing animated GIF → Quarantine/receipt → asynchronous validated processing → reviewer approval/rejection → public detail & searchable gallery → browser GIF Picker → selected asset reference in a demo Host surface.**

A rights attestation, policy gate, and reversible takedown are essential parts of this chain. The demo Host receives **Selected**, not a simulated `Sent`/`Published`. This is an engineering *thin slice*, **not** a new MVP or release-scope promise and does not prioritize `CTX-A` over `CTX-B`.

### Candidate comparison

| Candidate | Time to visible outcome | Architecture coverage | Problem | Verdict |
|---|---|---|---|---|
| Public read-only gallery seeded with test files | Fastest | Web/read/delivery only | No real upload, queue, moderation or critical lifecycle | Use as a **task checkpoint**, not final slice |
| Upload → Processing → Moderation → Publishing → Search → Picker | Strong multi-domain coverage | Identity, files, worker, safety, catalog, search, delivery, read API, UI | More steps; can be incremental | **Selected, with GIF-only input and demo picker** |
| Full platform w/ developer key, multi-platform SDK, video Clips and multi-step creation | Slow | Broad but diffuse | Unapproved Investigate scope; high integration complexity | Not first slice |

The slice builds a shared skeleton for the 10 systems without implementing the full Developer Portal, external SDK or enterprise infrastructure. It creates visible browser checkpoints after every milestone, not a “big bang” release.

## 2. Scope contract and Phase 02 traceability

| In slice | Why | Working Scope / source |
|---|---|---|
| Public gallery/search/detail and copy link | Browser-visible proof | `SC-01`, `SC-02`; `J05` Direct experience; `SF-01` |
| Physical animated **GIF file** ingestion only | Test the full media lifecycle with smallest real input | `SC-04`, `SC-07`, `SC-14`; full GIF+Sticker working area preserved as wider baseline |
| Minimal account/login with two seeded local personas | Ownership and reviewer separation | `SC-06`; Account/Channel distinction |
| Title/tags and uploader identity | Search, attribution, management | `SC-07/08/09/12` (minimal surface; not full Creator Studio) |
| Private quarantine, output GIF + static poster | Real storage, worker/processing and UI preview | `SC-14` and seven axes `FR-MEDIA-01…07` |
| Manual review plus rejection and removal | Block unsafe/unlicensed content before indexing | `SC-21/23/24`; `BR07-004`, `BR07-006` |
| Public search results with policy filtering | Publishing proves indexing but not universal reach | `SC-01/22`; no claim of GIPHY search parity |
| Basic browser embedded Picker + selection callback | End-to-end consumption and cross-boundary proof | `SC-19/35`, `BR07-001/003`; both A/B remain unranked |
| Developer-facing versioned read endpoint *internally reusable* | Avoid API architectural dead end | `SC-16` read model; **not** full public API/key product |

### Explicit exclusions *from this first technical slice only*

- Sticker upload/alpha behavior, video-to-GIF, Clips, Emoji, text stickers, media editor (`SC-05/10/15` Investigate) — architecture remains extensible.
- Public developer registration and API keys, full Developer Portal, usage analytics (`SC-17/27` Working Include at platform scale, **not slice**); native SDKs and advanced Picker customization (`SC-18/20` Investigate).
- Favorites, trending, automatic safety ML, copyright resolution, appeals interface, organization verification, partner distribution, commercial products, smart ranking, ads.
- Actual Host message send / social post endpoint: external Host remains sole authority; **demo selection acknowledgement** is all this slice proves.
- Any unlicensed third-party GIF catalog or imported GIPHY assets: use independently created, authorized synthetic/owned test fixtures.

**This is sequencing, not de-scoping** of Phase 02 Working Baseline or changes to Roadmap versions 1–4. Original 10 systems and release milestone definition remain unchanged.

## 3. User-observable happy path

1. Dev starts `docker compose up --build` + migrations/seed; browser opens `http://localhost:8080` and shows empty public gallery and `Sign in` button.
2. Uploader signs in with a **development-only seeded test account** (not default production account). Frontend shows upload form: GIF file, title, optional tags, and affirmative rights attestation.
3. Browser asks API for upload intent; receives a constrained, expiring **presigned POST** to quarantine. It uploads directly to S3-compatible store and calls `complete`; API verifies receipt without trusting browser metadata. UI displays durable Upload Receipt and progress states.
4. Separate worker validates content, duration, frame dimensions/count/resource bounds; re-encodes safe `display.gif` and first-frame `poster.png`; records variants. Item remains private, unindexed, and inaccessible through `/media`.
5. Reviewer (distinct account) sees pending item with an authenticated preview route, reviews and **approves**. Transaction sets visibility/eligibility/API availability and writes search document. Reviewer may reject or later remove. Every decision audited.
6. Public gallery/search finds only approved eligible GIFs. Detail shows attribution, title/tags and safe media delivery; a pending/rejected/removed asset returns restricted/not-found public contract.
7. Demo Host page opens Picker, types a keyword, previews accessible results, selects one; callback displays `selectedAssetId` + URL reference with label **Selected — host action not performed**. Dismiss returns `cancelled`, does not call any send/post API.
8. Reviewer removes it; new gallery/search/API/Picker reads cannot return it and subsequent origin media requests fail authorization, without claiming instantaneous removal from every past client cache.

## 4. Deliverable UI routes (Provisional)

| Route | Role | What you can see/test |
|---|---|---|
| `/` | Public | Gallery and search (empty/error/loading/eligible) |
| `/g/:assetId` | Public | Public GIF detail or not-found/restricted behavior |
| `/login` | Uploader/Reviewer | Login/logout with session and CSRF rules |
| `/studio/upload` | Uploader | File validation, metadata, upload progress, receipt, processing/review status |
| `/studio/assets/:assetId` | Owner | Private state receipt, status timeline, request delete later optional |
| `/review` | Reviewer | Pending queue; inspect safe private preview; approve/reject; remove after publish |
| `/demo/host-picker` | Public | Embedded Picker; selected/cancelled callback without actual Host send |

**Accessibility:** keyboard search, focus management for picker, `prefers-reduced-motion` support, alt/description for poster where available; no forced autoplay for reduced-motion users. The complete UX spec in P2-WP06 stays a reference; this slice implements only these routes and explicit states.

## 5. Lifecycle gates and no-false-positive rules

| Step | Operation authority | Observable success means | Explicitly **does not** mean |
|---|---|---|---|
| Upload intent | API | Permission and storage policy issued | File received |
| Quarantine receipt | API + object HEAD | Uploaded bytes located, metadata check started | Safe/decodeable GIF |
| Processing | Worker | New validated display GIF + poster stored | Public approval |
| Review | Human reviewer | Policy decision + audit persisted | Search ranking/reach |
| Publication | Catalog/Trust | Public eligibility granted and index projection committed | Third-party licensing cleared automatically |
| Search/API | Search/Read policy | Eligible asset returned for this policy/query | Every Host/context allowed to send it |
| Delivery | Media origin | Bytes delivered successfully in this request | All historic client caches consistent |
| Picker | Picker | Media reference selected/cancelled | Sent/posted/accepted by Host |

Expected failures: absent auth (401); wrong role (403); invalid upload/presigned policy (400/413); expired intent (410); object missing (409); truncated/corrupt GIF (terminal failed); worker crash (lease retries); moderation rejected (restricted); wrong actor review (403); duplicate complete (idempotent); double reviewer decision (409); request to publish without variants (409); removed asset hidden from public read; storage failure (503); empty search yields 200 with empty items. Specific contract in technical spec.

## 6. Vertical checkpoints (every one runnable)

| Checkpoint | End-to-end observable output | Proof |
|---|---|---|
| C0 — scaffold/health | Browser home + API ready + DB migrations | `GET /health/ready`; Playwright homepage |
| C1 — identity | Uploader/reviewer login, public unauthenticated gallery | Session security tests; browser login/logout |
| C2 — upload receipt | Upload GIF to quarantine with durable private receipt | Browser upload and HEAD equality test |
| C3 — processing | Receipt progresses, variants generated but public search empty | Worker fixture tests and denied `/media` |
| C4 — moderation | Reviewer approves/rejects, audit recorded | Role negative tests and state assertions |
| C5 — discovery & delivery | Approved GIF searchable, detail poster/playback, removal revokes read | DB search test, browser, public media denial after removal |
| C6 — picker demo | Search, preview, selection/cancel callback visible | Playwright click, Escape/cancel, no Host send |
| C7 — recovery, CI, deployment proof | Restart, retry, quality gates and production-like staging smoke | Full E2E suite, documented environment and rollback |

**Completion definition for first buildable slice:** all checkpoints C0…C7 pass together from clean checkout and clean local volumes with independently owned GIF fixtures. Neither writing the spec nor creating repository files counts as tested feature functionality.

## 7. Success acceptance scenarios

| ID | Given | When | Then |
|---|---|---|---|
| SL-AC-01 | Only test users; empty platform | Valid owner uploads GIF and completes | Receipt created, not public, one logical Asset ID |
| SL-AC-02 | Asset processing | Worker consumes queued job | Safe derivative GIF + poster stored, file type/duration bounds enforced |
| SL-AC-03 | Asset pending approval | Anonymous queries public search or media URL | No asset/result/bytes exposed |
| SL-AC-04 | Processed and pending | Reviewer approves | Exactly one decision recorded, eligible index/result appears |
| SL-AC-05 | Public item | Picker selects it | `selected` callback only; no send/post telemetry or API call |
| SL-AC-06 | Published item | Reviewer removes | New search/read and origin media requests deny; audit trail retained |
| SL-AC-07 | Pending item | Uploader attempts reviewer approval | 403 and no state or audit decision mutation |
| SL-AC-08 | Queue job already completed | Same complete or worker claim is retried | No duplicate display variants or public transition |
| SL-AC-09 | Invalid GIF or malformed upload | Complete/process | Typed failure, quarantined input private, user can retry a *new* upload |
| SL-AC-10 | Picker dialog open | Press Escape/cancel | `cancelled`, focus restored, no asset selected |
| SL-AC-11 | Web search query yields none | API returns empty list | Accessible empty UI, not mistaken for error/restricted |
| SL-AC-12 | Worker killed mid-processing | Lease expires and worker restarted | Processing recovers safely or terminal failure after bounded retries |

## 8. Risk and scope gates

- **Rights:** imported stock/GIPHY content is not permitted by default. Fixture upload attestation is educational/technical and not blanket permission for commercial third-party redistribution. Production legal terms/takedown require approval.
- **Moderation operational proof:** manual reviewer is enough to test gating, but not equivalent to a final policy or full T&S capability; no automatic ML moderation assumed.
- **GIF-specific processing limits:** frame bombs, decompression bombs, malformed headers, inconsistent metadata and running processes must be guarded; codec support must be verified empirically.
- **Locale and search relevance:** baseline search is deterministic keyword/tag look-up; no claim of universal Persian/other locale relevance.
- **Delivery revocation:** DB gate and short cache policy prevent new authorized origin access, **not** already downloaded media or universally cached CDN copies.
- **Governance:** owner has authorized this Phase 03 work and stated Phase 02 Working Baseline acceptance; exact SC/PRD approvals and missing P2-WP08 package remain unverified from accessible files. All P3 architecture and Slice decisions are provisional until owner signs off.

**Handover:** implement strictly from `First-Slice-Technical-Specification.md` + `Implementation-Backlog.md`; first agent task only creates scaffold/health, not the full product.
