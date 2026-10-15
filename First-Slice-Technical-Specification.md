# First Slice — Implementation-Ready Technical Specification

**Document:** P3-SPEC-01 | **Version:** 0.1 | **Date:** 2026-10-15 | **Authority:** Provisional technical design for the first buildable slice ONLY. No code delivered in Phase 03. All public URLs/thresholds below are proposed engineering contracts pending approval.

## 1. Executable boundary / Component Architecture

```mermaid
flowchart TB
  Browser[Browser / Next.js: public, studio, review, demo picker] --> Edge[Caddy single-origin]
  Edge --> API[Fastify API: auth | catalog | upload | review | search | delivery]
  API --> PG[(PostgreSQL)]
  API --> S3[(S3-compatible private buckets)]
  Worker[Worker process] --> PG
  Worker --> S3
  Worker --> FFMPEG[FFmpeg/ffprobe sandbox]
  API --> Media[Policy-checked media response]
  Media --> S3
```

- `apps/web`: Next.js routes/components, form validation and accessible state handling; **never writes DB**.
- `apps/api`: Fastify modules Auth, Catalog, Upload, Moderation, Search and MediaDelivery; HTTP DTO validation and authorization; **never runs FFmpeg in request path**.
- `apps/worker`: database job claims, object download, isolated FFmpeg/ffprobe and output upload; processing state transitions; **cannot approve public visibility**.
- `packages/domain`: stable domain types, state guards/transition commands (no framework HTTP imports); `packages/contracts`: request/response validators and OpenAPI; `packages/db`: SQL/Drizzle schema and migrations; `packages/storage`: S3 adapter; `packages/config`: validated environment.
- `infra/`: Compose, Caddy config, development seed, worker container, migrations and future staging template.

**Write ownership (enforced in code):** Upload owns upload receipts; Catalog owns asset + tags + variants; Processing owns processing/technical readiness; Moderation owns decisions and invokes Catalog's publish/unpublish command; Search owns `search_documents` projection; Auth owns users/sessions. Cross-module writes happen via transactional commands; no frontend/media worker SQL updates to other modules' domain state except through narrow repository interfaces. `AuditEvent` is append-only with privileged inserts.

**Allowed content in slice:** uploaded `.gif` animation only; content type logical `GIF` distinct from MIME `image/gif`; sticker type is modeled in catalog for future but no sticker route. No fetching remote URLs or GIPHY media. Test fixtures must be created/owned/redistributable.

## 2. Data model and PostgreSQL schema

IDs use UUID v4; all timestamps `timestamptz` UTC; tags are normalized lowercase/trimmed. Schema below is normative conceptual SQL for agent translation into Drizzle migrations; database CHECK constraints and key indexes are required. Avoid migrations that auto-delete approval/audit history. Pseudocode `public_id` is UUID, not guessable sequential ID.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE role_grants (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('UPLOADER','REVIEWER','ADMIN')),
  PRIMARY KEY (user_id,role)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_valid_idx ON sessions (user_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('GIF','STICKER')),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  description text,
  rights_attested_at timestamptz NOT NULL,
  rights_attestation_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1
);
CREATE INDEX assets_owner_created_idx ON assets (owner_id, created_at DESC);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 64)
);
CREATE TABLE asset_tags (
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY(asset_id,tag_id)
);
CREATE INDEX asset_tags_tag_idx ON asset_tags(tag_id,asset_id);

CREATE TABLE asset_states (
  asset_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  upload_state text NOT NULL DEFAULT 'INTENT' CHECK (upload_state IN ('INTENT','RECEIVED','EXPIRED','FAILED')),
  processing_state text NOT NULL DEFAULT 'NOT_STARTED' CHECK (processing_state IN ('NOT_STARTED','QUEUED','RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_TERMINAL')),
  visibility_state text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility_state IN ('PRIVATE','PUBLIC','RESTRICTED')),
  search_eligibility_state text NOT NULL DEFAULT 'INELIGIBLE' CHECK (search_eligibility_state IN ('INELIGIBLE','ELIGIBLE')),
  indexing_state text NOT NULL DEFAULT 'NOT_INDEXED' CHECK (indexing_state IN ('NOT_INDEXED','INDEXED','STALE')),
  api_availability_state text NOT NULL DEFAULT 'BLOCKED' CHECK (api_availability_state IN ('BLOCKED','ENABLED')),
  delivery_readiness_state text NOT NULL DEFAULT 'NOT_READY' CHECK (delivery_readiness_state IN ('NOT_READY','READY','DEGRADED')),
  moderation_state text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (moderation_state IN ('NOT_REQUESTED','PENDING','APPROVED','REJECTED','REMOVED')),
  processing_error_code text,
  state_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX states_moderation_idx ON asset_states(moderation_state,processing_state);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL UNIQUE REFERENCES assets(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
  quarantine_key text NOT NULL UNIQUE,
  requested_content_type text NOT NULL CHECK(requested_content_type='image/gif'),
  claimed_size_bytes bigint,
  received_size_bytes bigint,
  received_etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX upload_sessions_exp_idx ON upload_sessions(expires_at) WHERE completed_at IS NULL;

CREATE TABLE asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  rendition_version integer NOT NULL CHECK(rendition_version > 0),
  name text NOT NULL CHECK(name IN ('DISPLAY_GIF','POSTER_PNG')),
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes > 0),
  width integer NOT NULL CHECK(width > 0),
  height integer NOT NULL CHECK(height > 0),
  duration_ms integer,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id,rendition_version,name)
);

CREATE TABLE moderation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('APPROVE','REJECT','REMOVE')),
  reason_code text NOT NULL,
  reason_note text,
  prior_state text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_asset_time_idx ON moderation_decisions(asset_id,decided_at DESC);

CREATE TABLE search_documents (
  asset_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  title text NOT NULL,
  tag_text text NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',coalesce(title,'')),'A') ||
    setweight(to_tsvector('simple',coalesce(tag_text,'')),'B')
  ) STORED
);
CREATE INDEX search_docs_fts_idx ON search_documents USING gin(search_vector);

CREATE TABLE media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  job_kind text NOT NULL CHECK(job_kind='PROCESS_GIF'),
  generation integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','RUNNING','DONE','DEAD')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id,job_kind,generation)
);
CREATE INDEX jobs_due_idx ON media_jobs(status,available_at,lease_until);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  asset_id uuid REFERENCES assets(id),
  event_type text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_asset_created_idx ON audit_events(asset_id,created_at DESC);
```

**Schema rules:**

- `users` is a slice-level login principal, **not** a full Creator/Brand/Organization schema. Add channel/developer entities later rather than expanding `role` into an illegitimate ladder. The owner relation may later point to a channel grant; do not fake channel verification.
- `kind='STICKER'` reserves a logical type but **first-slice upload validation rejects it** until transparency pipeline and policy gates are implemented.
- `rights_attested_at/version` are an uploader **assertion**. They are neither proof of copyright ownership nor a broad license. Full rights/DMCA workflow is outside first slice.
- **Seven axes persist independently** in `asset_states`; moderation is an eighth distinct enforcement axis. Each owner domain updates only its justified values; missing object bytes can downgrade delivery while previous approval remains historically true.
- Search `search_documents` is built/removed in the **same transaction** as APPROVE/REJECT/REMOVE (V1 atomic index). Search results still join authoritative state before returning; do not equate `index exists` with distribution permission. Later external search may lag and must be re-filtered.
- The processing source remains in **private** quarantine. `asset_variants` refer to sanitized, re-encoded outputs in a distinct private bucket. S3 object keys are never user-supplied or inserted into public URLs.
- Audit events written transactionally for upload receipt, processing terminal outcomes, approval/reject/remove. Database access control prevents normal application DELETE/UPDATE against append-only audit events after insertion; backups/retention policy evaluated for production.
- `row_version` incremented on owner metadata changes and moderation operations; concurrency guard `WHERE row_version = expectedVersion` on critical writes.
- Migration must normalize/check tags, reject duplicate tags and enforce a provisional max e.g. 10 tags and 64 chars each at application layer; schema alone does not bound tags per asset.

## 3. HTTP API contracts (OpenAPI 3.1 generated; strict schemas)

**Base:** `/api/v1`. Response envelope for success: resource JSON (no universal envelope) with `requestId` header `X-Request-ID`; standard error envelope:

```json
{
  "error": {
    "code": "MEDIA_INVALID",
    "message": "The uploaded file is not a supported animated GIF.",
    "requestId": "req_...",
    "details": {}
  }
}
```

No stack trace/internal object key/unsafe file path/password/session/secret in client errors. All write endpoints reject unknown fields, validate JSON size and use `application/json`; upload is direct to object-store presigned **POST**, not API multipart binary. Timestamp ISO 8601. `requestId` is generated server-side (can accept validated inbound request ID only if trusted). Browser and server share route/DTO types from `packages/contracts`. Generated OpenAPI checked into repo and verified by CI diff.

### 3.1 Auth and health

| Method / path | Authorization | Request | Response / errors |
|---|---|---|---|
| `GET /health/live` | None | — | `200 {"status":"ok"}` process running |
| `GET /health/ready` | None internal health (exposed only for local/staging ingress) | — | `200 ready` when DB and storage basic checks pass; `503` otherwise. Do not divulge credentials. |
| `POST /auth/login` | Public same-origin, Origin validated, rate limited | `{email,password}` | `200 {user:{id,email,roles},csrfToken}` and secure HttpOnly session cookie; `401 INVALID_CREDENTIALS` uniform |
| `GET /auth/session` | Current cookie optional | — | `200 {authenticated:boolean,user?:{id,email,roles},csrfToken?:string}`; never raw token hash |
| `POST /auth/logout` | Signed-in + CSRF | — | `204`, revoke session & clear cookie; invalid CSRF `403` |

**Session:** random 32+ byte opaque token hashed SHA-256 at rest; constant-time secret compare where appropriate; secure `SameSite=Lax`, `HttpOnly`, `Path=/`, Secure in HTTPS; local insecure cookie **development only**; rotating session on login, expiry/revocation server side. `Origin`/Fetch-Metadata check on all unsafe methods and `X-CSRF-Token` bound to session for authenticated writes; login uses strict Origin + JSON request/response against login-CSRF. Never allow arbitrary `Access-Control-Allow-Origin:*` with credentials. Reviewer role is a separate seeded user; production bootstrap requires explicit secret/environment, no default exposed passwords.

### 3.2 Upload and owner state

| Method / path | Authorization | Contract / notes |
|---|---|---|
| `POST /uploads` | Uploader + CSRF; `Idempotency-Key` | Body `{kind:"GIF",title:string,tags:string[],rightsAttested:true,rightsAttestationVersion:"v1",claimedSizeBytes?:number}`. Atomic insert asset + `asset_states` + upload_session; issue **presigned POST** with content-length-range and MIME policy. Returns `201 {assetId,uploadId,expiresAt,method:"POST",form:{url,fields},state:{upload:"INTENT",processing:"NOT_STARTED"}}`. Replayed key returns same intent while valid; stale intent `409 UPLOAD_INTENT_EXPIRED` requiring a new key; `400/413` validations. |
| `POST /uploads/:uploadId/complete` | Same owner + CSRF | Body `{}`. HEAD exact quarantine key, verify object exists/size/MIME metadata; require unexpired intent and matching asset ownership; bytes are **not** trusted as a valid GIF until worker probes. In DB transaction, mark `RECEIVED`, `QUEUED`, insert unique media job and audit. Returns `202 {assetId,upload:"RECEIVED",processing:"QUEUED"}`. Duplicate complete is idempotent `202` current state; missing file `409 UPLOAD_OBJECT_MISSING`; expired `410 UPLOAD_INTENT_EXPIRED`; oversize `413`. |
| `GET /me/assets` | Owner | `200 {items:[{id,title,states,createdAt}],nextCursor?}`; only owned rows. |
| `GET /me/assets/:assetId` | Owner | `200 {assetId,title,tags,states:{upload,processing,visibility,searchEligibility,indexing,apiAvailability,deliveryReadiness,moderation},errorCode?,variantsReady:boolean,rowVersion}`; 404 for other owner. |

**Presigned form** response includes the exact policy fields signed by object store; CORS restricted. Client never receives long-lived object credentials. Quarantine bucket policy: no public GetObject. Backend must use **internal S3 endpoint** for HEAD/GET and public endpoint for browser signed POST, using an SDK signature test to verify Host correctness. Expired or incomplete quarantined object must be removed by a scheduled cleanup task *with audit/retention policy*; that cleanup is not a public Delete semantics guarantee.

### 3.3 Moderation endpoints

| Method / path | Authorization | Contract / notes |
|---|---|---|
| `GET /review/queue?limit=...` | Reviewer | `200 {items:[{assetId,title,ownerId,processing,moderation,rowVersion}],nextCursor?}`. Only processed `SUCCEEDED` and `PENDING` rows; no uploader access. |
| `GET /review/assets/:assetId` | Reviewer | `200` full review summary + safe variant paths; no raw quarantined media exposed to browser. |
| `GET /review/assets/:assetId/media/:variant` | Reviewer | Streams only sanitized existing `DISPLAY_GIF`/`POSTER_PNG`, `Cache-Control:no-store`; no raw upload bytes. |
| `POST /review/assets/:assetId/decision` | Reviewer + CSRF | `{decision:"APPROVE"|"REJECT",reasonCode:string,reasonNote?:string,expectedVersion:number}`; `200 {id,states,rowVersion}`. APPROVE requires process SUCCEEDED, variants verified, rights attested, moderation PENDING. REJECT requires reason. Competing stale version → `409 STATE_CONFLICT`; duplicate same decision must not insert a new audit/decision; return current state (`200`) only if semantics exactly identical or `409` otherwise. |
| `POST /review/assets/:assetId/remove` | Reviewer + CSRF | `{reasonCode,reasonNote?,expectedVersion}`. For previously published asset, set moderation REMOVED / visibility RESTRICTED / eligibility INELIGIBLE / API BLOCKED / indexing NOT_INDEXED and remove search projection **in same transaction**. Existing media origin denies subsequent access. `200`, audited. |

**Moderation sequencing:** processing success -> moderation `PENDING` (only after verified variant HEAD). Approval -> `APPROVED`, `PUBLIC`, `ELIGIBLE`, `INDEXED`, `ENABLED` in a transaction. `deliveryReadiness=READY` is technical readiness, never by itself a public permission. Reject -> `REJECTED`, `RESTRICTED`, `INELIGIBLE`, `NOT_INDEXED`, `BLOCKED`; keep private derivatives for authorized case management under retention policy. Removal can be separately recorded without erasing previous approval. Only reviewer role (or authorized admin delegation later) may decide. Review UI is a **minimal operational surface**, not a full Admin product.

### 3.4 Public read, search and media

| Method / path | Authorization | Contract |
|---|---|---|
| `GET /public/gifs?q=&limit=24&cursor=` | Anonymous | `200 {items:[{id,title,tags,creator:{id,displayName},posterUrl,displayUrl,createdAt}],nextCursor?}`. Policy filter requires GIF, process SUCCEEDED, moderation APPROVED, visibility PUBLIC, eligibility ELIGIBLE, indexing INDEXED, apiAvailability ENABLED and delivery readiness READY (actual byte availability may still fail). Missing/blank `q` = recent eligible; nonblank uses parametrized PostgreSQL FTS. `limit` default 24 max 50; `q` max 100 chars. `200 []` for no matches; invalid cursor `400`. |
| `GET /public/gifs/:assetId` | Anonymous | Same eligible projection + description/tag/attribution, or `404` if private/rejected/removed/unknown to avoid leaking existence. |
| `GET /media/:assetId/:variant` | Anonymous, reverse proxy outside `/api` | Only `display.gif` / `poster.png` aliases mapped to sanitized private objects by server. Re-check DB permission on **every origin request**; stream bytes with actual `Content-Type`, `Content-Length`, `ETag`, `X-Content-Type-Options:nosniff`, conservative configurable `Cache-Control:public,max-age=30` (temporary local choice). `404` if prohibited; `503 MEDIA_UNAVAILABLE` if object missing. Refuse arbitrary key/path, prevent traversal. No global cache purge guarantee. |

**Search algorithm V1:**

```sql
SELECT a.id, a.title, a.created_at, ts_rank(sd.search_vector, websearch_to_tsquery('simple', $1)) AS rank
FROM search_documents sd
JOIN assets a ON a.id=sd.asset_id
JOIN asset_states st ON st.asset_id=a.id
WHERE st.moderation_state='APPROVED' AND st.visibility_state='PUBLIC'
  AND st.processing_state='SUCCEEDED'
  AND st.search_eligibility_state='ELIGIBLE'
  AND st.indexing_state='INDEXED' AND st.api_availability_state='ENABLED'
  AND st.delivery_readiness_state='READY'
  AND sd.search_vector @@ websearch_to_tsquery('simple', $1)
ORDER BY rank DESC, a.created_at DESC, a.id DESC
LIMIT $2;
```

For empty `q`, omit FTS predicate and order by created_at/id. Stable signed opaque cursor stores query digest and last `(rank,created_at,id)` for keyset seek. **The agent must implement predicate consistent with those sort columns** and tests for duplicate/missing pagination under constant dataset; if the agent cannot safely complete rank-based keyset pagination in a small task, use explicit bounded offset pagination temporarily, document caveat and add conversion task before external API release. FTS does not guarantee relevance for every language; tags and case-fold handling must be validated on real fixtures. String SQL values above are parameters, never concatenated unescaped.

**Picker contract (in-app demo component, not SDK):** `onSelect({id,kind:'GIF',title,posterUrl,displayUrl})`, `onCancel()`, `onError({code})` to Host demo. The demo only updates a selected-reference card. No `send` or `post` endpoint, nor a false 'message sent' message. On Escape and close, cancel once and restore keyboard focus. Direct browser picker can use public search read route initially; `SC-18` SDK remains Investigate.

## 4. Media Processing Pipeline

```text
Upload intent -> presigned quarantine POST -> completed object HEAD -> immutable receipt
 -> media_jobs READY -> worker lease/claim -> ffprobe validation
 -> constrained FFmpeg re-encode -> checksum/metadata -> put private derivative objects
 -> HEAD-verify derivative bytes -> DB variant rows & processing SUCCEEDED
 -> moderation PENDING -> reviewer-only preview -> approve -> public index+read
```

**Accepted input (slice):** real animated GIF, not merely `.gif` extension or `Content-Type` header. Probe actual signature/decoding, multiple frames, dimensions >0, finite duration, resource bounds and expected no audio. GIF without animation can be rejected as `MEDIA_NOT_ANIMATED` for this slice (technical choice, not permanent product restriction). The limits in `Technology-Stack-Decisions.md` are **provisional local safety settings**. Prevent SSRF by never accepting remote URLs or enabling network in worker, and disallow embedded external resource expansion.

**Worker steps:**

1. Claim one due job atomically via `FOR UPDATE SKIP LOCKED` inside short transaction. `RUNNING`, increment `attempt_count`, set random `lease_token`, `lease_until=now()+leaseSeconds`; release row lock before external IO. A crashed lease can be reclaimed after expiry using job claim condition `status='RUNNING' AND lease_until < now()`. On long valid work, heartbeat lease only with matching token.
2. Download known quarantine object key to isolated temp dir (generated name), enforce length limits and operating system sandbox. Verify SHA-256. Use `ffprobe` on local file with finite timeout, stdout cap, parse checked JSON; reject malformed/oversize/too-many-frames/long duration; no reliance only on probe (actual re-encode must complete).
3. Re-encode decoded frames into a sanitized looping display GIF with FFmpeg `palettegen/paletteuse`, and extract first frame to `poster.png`. Example **reference plan**, not blindly assumed to work with every FFmpeg build:

   ```text
   ffmpeg -nostdin -loglevel error -i input.gif -filter_complex "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse[v]" -map "[v]" -an -loop 0 output.gif
   ffmpeg -nostdin -loglevel error -i output.gif -frames:v 1 poster.png
   ```

   Spawn using fixed argv (`execFile`/`spawn`, **never shell string interpolation**), validate binaries/codecs and reproduce output quality/animation, frame count, alpha if relevant later. Limit encoded output size too, not just input.
4. Compute metadata/checksums and upload immutable keys such as `assets/{uuid}/v1/display.gif`, `.../poster.png` to **private derivatives bucket**. HEAD-verify them. Worker DB transaction conditionally inserts/upserts variants with same hashes, changes processing→`SUCCEEDED`, delivery readiness→`READY`, moderation→`PENDING`, records audit, and completes leased job iff `lease_token` matches. If lease was stolen, worker must not update DB or overwrite existing version; immutable paths/version and hash protect state.
5. Clean temp files after success/failure; never return quarantined original through HTTP. Temporary/orphan derivative objects after DB failure may remain; cleanup reconciliation job can prune older unreferenced versioned objects after policy-defined grace period (not during live processing).

**Failure classes:**

- **Permanent** (`MEDIA_INVALID`, `MEDIA_NOT_ANIMATED`, `MEDIA_TOO_LARGE`, `MEDIA_TOO_LONG`, `MEDIA_DIMENSIONS_EXCEEDED`, `MEDIA_DECODE_FAILED`): `FAILED_TERMINAL`, job `DEAD`, publicly unavailable; owner sees typed error.
- **Retryable** (`STORAGE_TEMPORARY`, `FFMPEG_RESOURCE_TRANSIENT`, `DATABASE_TEMPORARY`): exponential backoff with jitter and max attempts (default local 3), state `FAILED_RETRYABLE` until retry or `FAILED_TERMINAL` after exhaustion. Timeout/cancel and stale lease must be tested; attempts bounded and error safe.
- **Broken/partially committed output:** derivative upload may succeed while DB transaction fails. Reconcile by deterministic keys/hash; idempotent job without extra variant rows; do not set processing success until both objects HEAD-verify and DB transaction succeeds.

**No direct browser media access to quarantine or private derivatives; all public delivery goes through server policy gate.**

## 5. State transitions and transaction boundaries

| Trigger | Upload | Processing | Visibility | Search eligibility | Indexing | API availability | Technical delivery | Moderation |
|---|---|---|---|---|---|---|---|---|
| Create intent | INTENT | NOT_STARTED | PRIVATE | INELIGIBLE | NOT_INDEXED | BLOCKED | NOT_READY | NOT_REQUESTED |
| HEAD-complete & enqueue | RECEIVED | QUEUED | PRIVATE | INELIGIBLE | NOT_INDEXED | BLOCKED | NOT_READY | NOT_REQUESTED |
| Worker claim | RECEIVED | RUNNING | PRIVATE | INELIGIBLE | NOT_INDEXED | BLOCKED | NOT_READY | NOT_REQUESTED |
| Media outputs HEAD-verified | RECEIVED | SUCCEEDED | PRIVATE | INELIGIBLE | NOT_INDEXED | BLOCKED | READY | PENDING |
| Reviewer APPROVE (atomic) | RECEIVED | SUCCEEDED | PUBLIC | ELIGIBLE | INDEXED | ENABLED | READY | APPROVED |
| Reviewer REJECT | RECEIVED | SUCCEEDED | RESTRICTED | INELIGIBLE | NOT_INDEXED | BLOCKED | READY* | REJECTED |
| Reviewer REMOVE | RECEIVED | SUCCEEDED | RESTRICTED | INELIGIBLE | NOT_INDEXED | BLOCKED | READY* | REMOVED |
| Processor permanent failure | RECEIVED | FAILED_TERMINAL | PRIVATE | INELIGIBLE | NOT_INDEXED | BLOCKED | NOT_READY | NOT_REQUESTED |
| Storage bytes unavailable post-approve | RECEIVED | SUCCEEDED | PUBLIC** | ELIGIBLE** | INDEXED** | ENABLED** | DEGRADED | APPROVED |

`*` READY means a *technical derivative* exists but is **not authorized to serve**. `**` These historic/business axes can remain unchanged under a transient technical delivery outage; read path must fail safely and preserve truthful degraded state. Reconciliation updates delivery readiness when actual missing bytes are confirmed. No one-dimensional published flag allowed.

**Approval transaction pseudocode:**

```text
BEGIN; SELECT assets + asset_states FOR UPDATE;
ASSERT reviewer role, expectedVersion, processing=SUCCEEDED,
  moderation=PENDING, right attestation, two derivatives verified READY;
INSERT moderation_decisions(APPROVE) + audit_events;
UPSERT search_documents(title,tag_text);
UPDATE asset_states(visibility=PUBLIC,searchEligibility=ELIGIBLE,
  indexing=INDEXED,apiAvailability=ENABLED,moderation=APPROVED);
UPDATE assets SET row_version=row_version+1; COMMIT;
```

**Removal transaction:** row lock and expected version; record `REMOVE` and audit, update policy states, delete search projection in same transaction; media permission checks deny post-commit. A concurrent public GET that started before removal cannot be retroactively un-sent; guarantee only checks at request start/response stream gate, no instantaneous global cache invalidation.

**Idempotency/concurrency tests:** two workers claiming same job, upload-complete double click, network timeout after S3 POST, worker crash after derivative upload but before DB commit, two reviewers race, approval for stale version, public query concurrent with removal, repeated POST REMOVE, tampered S3 keys. Use process-level and DB integration tests, not mocks only.

## 6. Security / Trust / Access Matrix

| Action | Anonymous | Uploader (owner) | Other uploader | Reviewer |
|---|---|---|---|---|
| Public search/detail approved | Allow | Allow | Allow | Allow |
| Upload intent and complete | 401 | Allow (own) | Allow (their own) | Only if also granted UPLOADER |
| View private owner receipt | 401 | Own asset only | 404 | Reviewer queue only if authorized |
| Review queue/safe preview | 401 | 403 | 403 | Allow |
| Approve/reject/remove | 401 | 403 | 403 | Allow, version guarded |
| Public media approved | Allow | Allow | Allow | Allow |
| Public media pending/rejected/removed | 404 | 404 (owner uses private receipt; not public media) | 404 | 404 (private reviewer preview separate) |
| Source quarantine bytes | Never | Never via HTTP | Never | Never via HTTP |

Further controls: least-privilege S3 identity for API/worker (API allowed presigned post and GET derivative; worker can read quarantined input/write derivatives), no public bucket ACL; byte/pixel/frame/duration/decoder timeouts; upload per-user rate limits; API query cost bounds; server-validated tags; CSP and output escaping, URL sanitization; no SVG upload; Argon2id password hashing; credential rotation; security headers; structured safe logs; session fixation protection. `robots.txt` and `noindex` on private routes. Prefer authz middleware + domain policy checks, not only hidden UI controls.

**Rights caveat:** Validating `rightsAttested:true` is sufficient only for a local demonstration. Commercial public distribution and rights-holder claims need signed terms/valid legal basis and takedown procedure before external production launch; no one checkbox legally validates content ownership.

## 7. Local development environment

**Ports:** Caddy `8080`, MinIO S3 `9000` (console optional `9001` local-only), Postgres available to app containers `5432`, optional host mapped for developer tools. Docker Compose `web`, `api`, `worker`, `db`, `minio`, `edge` with healthchecks and named volumes. Dev-only MinIO provisioning ensures both buckets private and CORS restricted to `http://localhost:8080`. No `0.0.0.0` production ingress by accident; dev controls and credentials clearly named.

**Commands required to work from fresh clone** (implemented in backlog Task B00/B01):

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:infra            # postgres/minio and bucket bootstrap
pnpm db:migrate
pnpm db:seed:dev           # refuses NODE_ENV=production
pnpm dev                  # web/api/worker/edge, or docker compose up --build
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm lint && pnpm typecheck && pnpm build
```

A single documented **recommended** path must be consistent (full Docker Compose or hybrid), not commands that require contradictory endpoints. Decide with the first coding task and prove via README from clean checkout. `.env.example` contains only local placeholders; `.env` gitignored. Do not start with a remote paid cloud provider.

## 8. Test strategy and quality gates

| Test class | Minimum required tests | Execution environment |
|---|---|---|
| Domain unit | Seven-axis invariants; illegal transitions; role matrix; tag validation; idempotent status updates; signed cursor parsing | Vitest |
| DB integration | migration rollback/readiness; FKs/checks; two concurrent worker claims; approval+index atomically committed; remove+search document deleted | Real PostgreSQL, seeded transaction fixtures |
| Object-store integration | browser-facing POST URL signature, max size rejection, object HEAD, private buckets, wrong MIME/tag, missing object | Real local MinIO with CORS (not mocked) |
| Worker integration | valid 2+ frame GIF, malformed, giant dimensions, long duration, no animation; derivative output decode; crash/retry/lease takeover and no duplicates | ffprobe/FFmpeg pinned binary + local bucket |
| HTTP security | 401/403/404 access, Origin/CSRF, session expiry, invalid schema, reviewer-only approve, 404 for nonpublic media, rate controls | Fastify inject plus real DB |
| Browser E2E | uploader login/upload/status, reviewer approve, public search/detail/media, picker keyboard select/cancel, remove and denial | Playwright + Compose healthy |
| Non-functional smoke | Media poster fast enough to render locally, reduced-motion behavior, accessibility baseline, worker restart recovery, traceId | Browser + scripted checks; **no fabricated numeric SLO** |

**Fixture policy:** generate own small 2-frame loop GIF from owned pixels, plus static GIF, corrupted bytes, byte oversized, hostile dimensions, wrong MIME and known unicode tags. Fixtures must not copy third-party/GIPHY copyrighted media. CI tests must not rely on internet for test data. No test is claimed passed in this planning document.

**Definition of Done for complete slice:** (1) clean checkout boot/seed; (2) CI build/lint/typecheck/unit/integration/e2e pass; (3) no unauthorized pre-approval delivery; (4) approved discoverable and selected; (5) rejected/removed inaccessible; (6) queue recovery and idempotency proven; (7) docs/OpenAPI in sync; (8) no credentials in logs/commits; (9) reviewer audit trail demonstrable.

## 9. Repository layout (agreed as technical proposal only)

```text
gif-platform/
  apps/
    web/                   # Next.js public/studio/review/picker demo
    api/                   # Fastify modular HTTP entrypoint
    worker/                # dedicated processing process
  packages/
    config/                # env schema
    contracts/             # Zod schemas + generated OpenAPI
    domain/                # asset/state/policy commands
    db/                    # Drizzle schema, SQL migrations, seeds
    storage/               # S3 interface and client adapter
    testing/               # fixture factories/integration helpers
  infra/
    compose.yaml
    caddy/Caddyfile
    minio/                 # dev bucket provisioning & CORS
    docker/                # pinned runtime/worker builds
  tests/e2e/               # Playwright
  docs/                    # architecture summary, runbooks, API contract
  .github/workflows/ci.yaml
  .env.example
  pnpm-workspace.yaml
  pnpm-lock.yaml
  package.json
  README.md
```

`apps/web` must use HTTP contract, not import DB layer; `apps/worker` uses domain commands but no API/React imports. OpenAPI contract generated in-repo by agent and verified for drift; this architecture packet itself is **not product code**.

## 10. Deployment approach and rollback

**Staging:** container images versioned by immutable Git SHA; a single regional ingress→`web`, `api`, independent `worker`; managed Postgres and S3-compatible private object store; secret injection and TLS at edge; health/readiness probes; DB backups and documented recovery drill. No asserted vendor, region, CDN, Kubernetes, multi-zone SLA or QPS/size target. Provision reviewer credentials securely, remove dev seed. Restrict review surface with strong AuthN/AuthZ. Roll forward/back via backward-compatible migrations (expand/migrate/contract), rollback app image separately; do not revert published schema destructively. Media variant paths immutable across deploys. A failed migration aborts deploy; job processing must resume safely after rollback. Production exposure **blocked** until rights/legal terms, data policy, moderation operator controls, credential provisioning, safety limits, backup/restore and media revocation semantics approved.

**CDN future:** private bucket; media origin policy may cache only per reviewed TTL; add explicit purge operations and audit on revocation. If CDN cannot meet agreed revocation requirements, keep the policy-gated origin (with acknowledged bandwidth cost) until alternative exists. No promise that a takedown deletes content from downstream recipients.

## 11. Traceability, unknowns and change gates

- Core mapped Phase 02 Scope IDs: `SC-01/02/04/06/07/08/09/12/14/16/19/21/22/23/24/35`. First slice intentionally does **not** implement all working-included features under each SC. Public/enterprise API and Developer Portal remain later system modules.
- Referenced Phase 02 invariants: `BR07-001` picker ≠ host send; `BR07-002` app key ≠ user login; `BR07-003` API/SDK/Picker split; `BR07-004` separate media axes; `BR07-006` rights separate from cache. Working seven axes align with `AX07-01…07 / FR-MEDIA-01…07`, but exact SQL enums are new Provisional architecture choices.
- First-slice acceptance `SL-AC-01…12` in `First-Buildable-Slice.md`; implementation steps `B00…B09` in `Implementation-Backlog.md`. Formal P2-WP07 AC05/AC06/AC07 register remains an inherited design reference, **not** a claim that full 224 original scenarios are implemented/passed.
- Open owner decisions: Phase 02 Working Baseline formal trace, source rights/policy, production region/data privacy, actual market/locale, review entitlements, versioned public developer API contracts, media size SLA, production CDN/cache policy. None must be hallucinated to start **local** code.

**Readiness:** enough detail to hand the first scaffold task to an AI Coding Agent; implement task-by-task with passing tests, review each patch and preserve Provisional labels.
