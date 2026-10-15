# Architecture Decision Records — Phase 03 Provisional Register

**Document:** P3-ADR-01 | **Date:** 2026-10-15 | **Register status:** **All decisions PROPOSED, not Approved**. ADRs below are **architecture recommendations**, not new confirmed `DEC-*` project decisions. No canonical governance document has been edited. Owner's explicit Phase 03 instruction permits preparing this packet, not automatically endorsing each choice.

## 1. Decision sources and preservation

**Confirmed governance (not new):** DEC-001 = 12-phase roadmap; DEC-002 = independent platform, GIPHY reference; DEC-008 = Phase 01 Completed with Gaps and Stage B scientific debt preserved; DEC-009 = historic Phase 02 planning initiation. Owner now supplies a later **Phase 02 Working Baseline accepted** statement and starts Phase 03. Root governance files are stale snapshots and no newer confirmed DEC entries are visible in accessible archives. `P2-WP07` generated proposals are not owner-approved item-by-item decisions. **These P3-ADR IDs deliberately do not reuse DEC numbering.**

**Product context carried forward, not invented:** 35 `SC` areas (20 provisional Working Include/12 Investigate/2 Deferred/1 Excluded), own-product PRD 198 candidate requirements (0 explicitly Approved *in its historic file*), four canonical roadmap versions, D2 Preferred (not strategy approval), CTX-A/B unranked, CTX-C supply overlay, seven media truth axes, Host final-action authority, rights/ratings separation. A first code slice does not automatically set new product/release scope.

## 2. Proposed ADR summary

| ADR ID | Decision (PROVISIONAL) | Alternatives | Rationale / impact | Revisit when |
|---|---|---|---|---|
| **P3-ADR-001** | Start with **Modular Monolith API + separately deployed worker process**, shared domain modules | Microservices from day one; single synchronous server | Small operational footprint, transactional safety and independent media CPU isolation; module discipline required | Different release/security/fault domains or measured scaling justify service split |
| **P3-ADR-002** | **TypeScript/Node 24 LTS**, pnpm workspaces; Next.js Web + Fastify API + Drizzle/Postgres | Go/Rust backend; NestJS; Vite; Prisma | One type system and developer workflow; low initial overhead, raw SQL allowed for FTS/locks | Performance, hiring/team reality, language specialization or product client constraints demand change |
| **P3-ADR-003** | **PostgreSQL 17** as transactional source of truth; **PostgreSQL FTS** first search | Multi-DB; MongoDB; Elasticsearch/OpenSearch immediately | Atomic moderation+index, fewer moving parts; relevance and language capability intentionally limited | Measured relevance, typo, language, multi-tenant and volume needs exceed PG |
| **P3-ADR-004** | **Durable DB job table using SKIP LOCKED, leasing, dedupe** | Redis/BullMQ, RabbitMQ, Kafka, synchronous process | Native transactional enqueue; avoids extra infra. Must implement lease/retry carefully | Queue operations, throughput/latency or multi-region semantics become bottleneck |
| **P3-ADR-005** | **S3-compatible private quarantine/derivative buckets**; MinIO **local-only** | Local filesystem; fully managed S3 production vendor immediately | Reproducible direct uploads, production-agnostic storage adapter, no raw public files | License/policy/region/vending/storage availability decisions |
| **P3-ADR-006** | **FFmpeg/ffprobe GIF-only re-encode first**, produce `display.gif` + `poster.png` | Media SaaS, mixed ImageMagick/Sharp, all formats initially | Validates animation, processing and safe previews while limiting codecs | Sticker alpha, video and real quality/performance requirements; codec issues |
| **P3-ADR-007** | **Human reviewer gate; private until approved; search/index/revocation transactional** | Automatically publish; ML auto-moderate immediately; queue-only publish | Demonstrates non-public state and safe availability; reviewer operations and auditable actions | Approved safety policy and scale need auto/ML review; distributed search introduced |
| **P3-ADR-008** | **Opaque server-side web sessions/CSRF** plus local-only seeded uploader/reviewer; Developer keys separate later | Production OIDC now; stateless JWT everywhere; anonymous uploader | Real authorization/test proof quickly, avoids fake dev bypass; early auth deliberately not full identity feature | Public registration, enterprise SSO/OIDC, organizations and authentication requirements |
| **P3-ADR-009** | **Policy-gated media origin**, private derivatives, short configurable cache before selecting CDN | Public S3 objects/permanent signed URL, CDN from day one | Allows origin to deny media immediately on new request after removal; bandwidth/latency costs accepted as unknown | CDN/removal latency/SLO/compliance require an explicit edge strategy |
| **P3-ADR-010** | **One thin buildable GIF E2E flow** incl. browser Picker demo only; no SDK/Host send | Read-only seeded gallery; broad GIF/Sticker/Clip/SDK first release | Tests all critical architecture seams while retaining product context parity and Host boundary | Owner explicitly authorizes different first code flow, or testing shows blocking safety/legal dependency |
| **P3-ADR-011** | **Contract-first REST/OpenAPI 3.1 + typed errors + versioned `/api/v1`**, internal read model reused later | GraphQL; ad hoc JSON shape; public developer product in slice | Testable interfaces and no implicit public API-key commitment | External developer contract, quotas/versions/product agreements approved |
| **P3-ADR-012** | **Docker Compose local and staged containers** with portable interfaces; no Kubernetes selection | Cloud/Kubernetes initial; serverless FFmpeg | Deterministic local test, low initial operational burden; ability to migrate | Operational scale, region/legal availability and runtime SLAs clarified |

## 3. Detailed decisions and acceptance criteria

### ADR-001 — Architectural modules, not prematurely network services

**Context:** Ten roadmap systems must be architecturally understandable, but only one vertical slice is being built. **Choice:** logical bounded contexts (Auth, Catalog, Upload, Processing, Moderation, Search, Media Delivery, Developer, Picker, Analytics, Operations); a single API application for HTTP, worker as separate process. **Positive:** easy local debugging, one DB transaction for approval/index; no distributed saga. **Trade-offs:** possible monolith coupling and shared deployment. **Guardrails:** no direct cross-module table mutation, adapter interfaces, dependency tests and change-owned schemas. **Review evidence:** complex cross-team deployment or measured hot path. **Status:** Proposed.

### ADR-002 — Stack selection and reversible versions

**Context:** User wants Codex/Cursor handoff without new study cycle. **Choice:** Node 24 LTS + Next 16.x Active LTS + Fastify 5 + Drizzle + PostgreSQL 17 + Zod. **Evidence:** Official Node.js/Next.js release/support pages dated as of 2026-10-15 support current LTS lines; library version compatibility must still be validated by agent during B00. **Consequences:** all app packages typed; no speculative version pinning in these documents. **Reversibility:** web and API deployment boundaries stay REST; libraries can be swapped behind module layers. **Status:** Proposed.

### ADR-003 / 004 — One database, two distinct jobs: truth + projection

**Choice:** use Postgres to hold authoritative seven axes and moderated search projection, plus durable media job lease row. **Atomicity rule:** upload completion and job insert in one transaction; approval/revocation and search projection update in one transaction. Object storage writes are **not transaction participants**; idempotent object versions, HEAD checks, recovery and reconciler needed. **Trade-off:** load on PG and queue lease implementation complexity; queue itself is not a publish event. **Revisit:** metrics/quality, not hypothetically massive scale. **Status:** Proposed.

### ADR-005 / 006 / 009 — Media safety and revocation are separate concerns

**Choice:** physically private raw and derivative buckets, no source-file proxy; constrained FFmpeg worker; public media route checks authoritative state for every request. **Consequences:** safe boundary and private pending/rejected derivatives; origin streaming introduces bandwidth; client/local caching cannot be globally retroactively removed. **Risk:** FFmpeg decoder vulnerabilities and decompression attacks require pinned binaries and resource isolation. **Review triggers:** operator safety policies, legitimate content rights, CDN plans. **Status:** Proposed.

### ADR-007 — Review workflow

**Choice:** human reviewer must explicitly approve processed GIF; no automatic publish on processing completion. Reviewer cannot be ordinary uploader by default, and reviewer decisions are audited. **Consequences:** content may remain pending (intentionally), operational bottleneck and no automatic harmful-content classification. **Risk:** local reviewer is an engineering scaffold, *not* a final rights/legal compliance guarantee. **Status:** Proposed.

### ADR-008 — Web identity vs developer applications

**Choice:** opaque DB sessions and role grants for slice; future Developer App/API key is a different entity, not creator auth or Host user. **Trade-off:** bootstrap sessions and DB expiry require operations, but revoke behavior is clear. **Revisit:** genuine SSO needs, cross-device onboarding, production identity provider. **Status:** Proposed.

### ADR-010 / 011 — Scope vs first build order

**Choice:** read-only gallery as checkpoint, but finish full actual GIF upload→process→review→search→picker chain. **Host boundary:** callback is selected reference only; no Host Send/Post. **API boundary:** versioned read API is internal consumption now, future external Developer Platform requires separate auth/quota/policy approval. **Consequences:** early integrated proof without claiming public SDK capability. **Status:** Proposed.

### ADR-012 — Deployment and observability

**Choice:** Compose and immutable containers plus health endpoints, structured logs and tracing hooks. **Trade-off:** not a complete production HA design; infra cannot be declared launch-ready until backup/secret/legal/review controls and numeric requirements are chosen. **Status:** Proposed.

## 4. Decisions *not* made (must not be inferred)

- No project `DEC-010` or beyond assigned. No change in the 12-phase roadmap, original ten core systems, four release milestones.
- No unconditional owner approval for all 20 Working Include domains, exact 198 PRD candidates, D2 strategy or A/B priority.
- No chosen marketplace, market, language, geography, buyer, pricing, contracts, source content licensing, retention policy, ads, paid API pricing or partnership entitlements.
- No production CDN/cloud/region, search vendor, SDK platforms, deployment SLA, cache-purge guarantee or video/Sticker format parity.
- No assumption about GIPHY database internals, ranking, CDN provider, moderation console or rights adjudication.
- No claim that locally created code exists or that spec tests have already passed.

## 5. Risk register — technical decisions requiring eventual approval

| Risk ID | Risk | Impact | Local mitigation / unresolved owner gate |
|---|---|---|---|
| P3-R-01 | Missing accessible P2-WP08 architecture-readiness/closure and Phase 03 handover | Cannot reconcile all prior acceptance detail | User explicitly authorizes Phase 03 and accepts Phase 02 Working Baseline; preserve gap and do not fabricate content |
| P3-R-02 | Rights attestation mistaken for redistribution license | Unlawful third-party content exposure | Own/synthetic fixtures only local; legal/policy review before public launch |
| P3-R-03 | False equivalence of processing vs public availability | Unsafe unintended content publication | Seven-axis guards, manual review, default-deny origin, negative tests |
| P3-R-04 | Stale CDN/client copies after removal | Legal and safety propagation | Policy-gated origin, bounded local caching, no global purge promise; CDN decisions later |
| P3-R-05 | FFmpeg resource exhaustion or malicious decoder inputs | Worker crash, host compromise | Sandbox, timeouts, size/pixel/frame limits, patched codecs, no network |
| P3-R-06 | Poor multilingual PostgreSQL FTS results | Bad quality outside test data | Declare keyword-only capability; evaluate real language/search needs before scale |
| P3-R-07 | DB-backed jobs stalled or duplicated | Processing outage/inconsistent output | Lease tokens, retry ceiling, immutable object versions, unique constraints, crash tests |
| P3-R-08 | Leaked/local credentials in production | Unauthorized moderation/content access | Dev seed disabled in production; secrets injection, TLS, role/access logging and audits |
| P3-R-09 | Undecided privacy jurisdiction/retention/Host telemetry | Regulatory exposure | Minimal operational events; no Host send inference; consent/privacy gate before external service |

## 6. Proposed formal adoption procedure (no action taken)

1. Project owner explicitly approves or amends these **P3-ADR** technical recommendations.
2. Approved decisions can then be added as new sequential `DEC-*` items to canonical `Project-Decision-Log.md` **only by an authorized governance update**, and reflected in `Project-Status.md`/roadmap status without changing its phase structure.
3. Coding Agent uses Provisional spec for local experimentation until such approval; changes surfaced as ADR amendments instead of rewriting Product Scope.
4. At each engineering task, test and record evidence; implementation success does not retroactively validate GIPHY research or Phase 02 market hypotheses.

**Next:** start Coding Agent task B00 from the exact prompt in `Coding-Agent-Handover.md`; after its executed tests and review, proceed B01.
