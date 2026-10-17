# B08 operations runbook

Scope: the approved local modular API/worker/PostgreSQL/private-S3 architecture. These are operator shell commands, not a new administrative product. Docker execution already grants privileged access to the stack; restrict that access to operators, retain command output in an access-controlled incident record, and do not share credentials or raw storage listings. No retry mutation endpoint is provided.

## Diagnose and correlate

Run after the README boot/migrate/seed sequence:

```sh
pnpm ops:inspect
pnpm ops:orphans 11111111-1111-4111-8111-111111111111
```

Replace the example UUID with the incident's asset ID. The wrappers execute the installed script in `api` with explicit `ALLOW_INTERNAL_OPERATIONS=true`; calling it without this opt-in fails. A repeatable-read, read-only database transaction returns at most 100 non-DONE jobs and 100 degraded assets, ordered deterministically, with `truncated` if additional rows exist. It selects no titles, account emails, notes, credentials, tokens or private object identifiers. Unknown stored error codes become `UNKNOWN_FAILURE`. Every invocation emits an operation ID; failures emit a safe classification and nonzero exit without raw SDK/SQL errors. This is a point-in-time diagnostic, not a durable action queue or completeness claim. Narrow investigation by asset ID using authorized database access when truncated.

API errors contain `error.requestId`, matching `X-Request-ID`. The safe API log record has the same ID, registered route template, HTTP status and classification. Incoming request IDs are ignored. Use the upload-receipt request ID from diagnostics to find the originating request; worker logs correlate by job ID, asset ID and attempt. Processing outcomes and moderation/delivery events remain in append-only audit history. No query string, upload signature, raw error/decoder output, temporary path, cookie, CSRF token, private object key or moderation note belongs in an incident's shared logs.

Compose PostgreSQL uses terse error logs, disables statement/parameter logging and suppresses error statements; otherwise a constraint's rejected-row detail could reveal private values. Do not enable verbose SQL logging on the application database to diagnose an incident. `scripts/test-operations.mjs` injects a real CHECK failure and asserts its private sentinel is absent from all service logs while the failure remains observable.

| Action classification      | Permitted recovery                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAIT_FOR_BACKOFF`         | Restore dependencies and wait until `availableAt`. Do not accelerate retries or reset attempts.                                                                                  |
| `AUTOMATIC_RETRY`          | Keep a worker running; it claims the persisted due job once.                                                                                                                     |
| `WAIT_FOR_LEASE`           | Wait; the current worker may still be processing. Never steal a valid token.                                                                                                     |
| `AUTOMATIC_LEASE_RECOVERY` | Keep/restart a worker; after database-clock expiry it reclaims with a fresh token or marks exhausted work DEAD.                                                                  |
| `MANUAL_INVESTIGATION`     | Inspect safe failure code/audit and dependency state. DEAD jobs, malformed leases and confirmed derivative loss have no automatic reset command. Escalate restoration decisions. |

## Dependency and process recovery

For this disposable development Compose project:

```sh
docker compose --env-file .env -f infra/compose.yaml stop db
docker compose --env-file .env -f infra/compose.yaml start db
docker compose --env-file .env -f infra/compose.yaml stop minio
docker compose --env-file .env -f infra/compose.yaml start minio
docker compose --env-file .env -f infra/compose.yaml kill -s SIGKILL worker
docker compose --env-file .env -f infra/compose.yaml start worker
pnpm ops:inspect
pnpm test:smoke
```

Only kill the worker after observing an active job to exercise interruption; the deterministic integration harness kills after both derivative uploads and before commit. Source versions, content-addressed conditional writes, unique variant rows and token fencing already protect restart. One worker process handles one job at a time; horizontal attempts still use `SKIP LOCKED`. No operator action edits moderation. Upload initiation retries must reuse the same idempotency key and metadata; lost completion or moderation responses retry the exact original request/version. A 503 means the operation could not be confirmed, not permission to invent a replacement business decision. Recheck the committed receipt/history before changing input.

Defaults remain three attempts, persisted capped exponential backoff with jitter, 30-second leases with heartbeats, 60-second whole-job timeout and 10-second decoder timeout. Timeout is an existing terminal media classification; transport/resource failures are retryable up to the ceiling. SIGTERM aborts active work, leaving a fenced lease for legitimate expiry. PostgreSQL server-side statement/idle-transaction timeouts now complement client deadlines for processing, upload and moderation. A database outage may prevent failure persistence; expiry, not an unfenced update, provides recovery.

Temporary storage outage returns safe 503 and preserves decisions. Confirmed lost/corrupt pinned media records technical `DEGRADED` once; processing/approval history remains true and all public reads deny eligibility. Do not flip READY, switch to a different object version, reapprove or silently regenerate. Exact-version restoration and any future audited readiness-repair command require a reviewed incident plan; B08 deliberately supplies no mutation for this.

## Liveness and readiness

| Probe                              | Meaning                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API `/api/v1/health/live`          | Process answers HTTP; 200 even during dependency outage.                                                                                                                                                                                                                   |
| API `/api/v1/health/ready`         | PostgreSQL query and bounded MinIO health plus authenticated existence/enabled-versioning checks on both buckets; 503 for failed dependencies, no-store. Does not certify every asset or replace policy gates.                                                             |
| Worker `/tmp/gif-worker-heartbeat` | Event loop liveness; timestamp refreshed every 5 seconds. Compose startup health uses this with a 15-second freshness bound, allowing first seed to provision its restricted DB role.                                                                                      |
| Worker `/tmp/gif-worker-ready`     | Successful restricted-identity schema query and authenticated enabled-versioning probes on both buckets, refreshed every 5 seconds; removed after failed probe/shutdown. Require freshness under 15 seconds. This does not guarantee future IO or each object's integrity. |
| Edge API outage                    | HTTP 502, browser safe unavailable state. Web process availability does not assert API readiness.                                                                                                                                                                          |

Check worker readiness (exit nonzero if missing/stale):

```sh
docker compose --env-file .env -f infra/compose.yaml exec -T worker node -e "const f=require('node:fs');process.exit(Date.now()-Number(f.readFileSync('/tmp/gif-worker-ready','utf8'))<15000?0:1)"
```

The worker identity gains only bucket-level `s3:GetBucketVersioning` on the two configured private buckets for authenticated probes. Existing object permissions and denials remain unchanged. When upgrading existing local volumes rerun `storage-worker-init` to apply the policy. External identity provisioning must include this metadata permission; do not grant bucket listing, policy changes or deletion to the worker.

## Resource guardrails

| Operation                     | Guardrail                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                         | Existing 10/account and 50/peer per 15 minutes, 10,000-entry process-local limiter; uniform errors.                                                                                                                                     |
| Upload intent                 | Existing database-serialized 20/owner per 15 minutes across API instances; idempotent replay precedes quota charging.                                                                                                                   |
| Upload/derivative             | Existing 20 MiB maxima; signed POST/HEAD/stream checks, 16,000,000 pixels, 4096 maximum dimension, 300 frames, 30 seconds.                                                                                                              |
| API JSON                      | Existing 16 KiB body limit and exact Origin/Fetch Metadata/session-bound CSRF.                                                                                                                                                          |
| Public search/detail + Picker | `PUBLIC_READ_LIMIT_PER_MINUTE=300` per actual socket peer, shared search/detail budget. Query max 100 characters, tag max 64, page max 50 and bounded SQL.                                                                              |
| Public media                  | Separate `PUBLIC_MEDIA_LIMIT_PER_MINUTE=600`, `PUBLIC_MEDIA_MAX_CONCURRENT=5` maximum active reads per process; each output bounded to 20 MiB. Rate exhaustion 429; active-read saturation 503 `MEDIA_BUSY`, both Retry-After/no-store. |

The three new public values are **Provisional local safety settings**, not owner-approved production capacity. Explicit values are required in production configuration (concurrency 1–5; rates 1–100,000). Production capacity, distributed limiting and trusted reverse-proxy identity require human review. No forwarded headers bypass limits: Caddy users share its socket-peer budget, and server-side detail reads share the web peer budget. Search and media have independent bounded 10,000-peer maps, expire every minute and fail closed at capacity. These are request/IO controls, not a production bandwidth guarantee. Existing decoder/container CPU, memory, process, network and filesystem isolation stays in force.

## Orphan detection and manual review

`pnpm ops:orphans <asset-uuid>` is always a dry-run and never deletes. It rejects extra/destructive flags and traversal. Scope is exactly two server-computed prefixes: quarantine for that asset in the configured quarantine bucket and derivatives for that asset in the configured derivatives bucket. No custom bucket/prefix/global wildcard is accepted. One version-list request per bucket, at most 100 entries each, a 4-second request deadline and no automatic pagination. `truncated=true` means incomplete evidence, never permission to delete.

All generations/pinned derivative keys and upload receipt keys protect **every version** of those keys, even for rejected/removed assets. Any processing job, any completed upload, any unexpired intent, or an oversized reference set protects the entire scope. Unmatched versions are only `MANUAL_REVIEW_ONLY`. Output includes a SHA256 fingerprint of bucket/key/version tuple, storage category and classification, not private identifiers. No age threshold can establish deletion safety by itself.

There is no common transaction/lock shared by S3 signed uploads, conditional worker writes and future PostgreSQL pinning. A crashed worker's upload could still finish, or its retry could adopt that key after a snapshot. Consequently **B08 cannot prove safe automated deletion**. Detection deliberately retains objects and therefore remains safe under concurrent operations and uncertain outcomes.

Manual workflow: retain the operation ID/output privately; investigate the scoped inventory with authorized read-only storage/DB tools; identify active intents, all jobs and every pin; investigate retention/rights obligations; obtain an explicitly approved incident plan that fences writers and unexpired signed uploads and rechecks exact versions. Destructive action requires separate explicit human confirmation of exact versions and proof of exclusive control. Without that proof/approval, retain the objects. Never use global bucket deletion, lifecycle expiration on these prefixes or timestamp-only cleanup. This runbook is not authorization to execute deletion. Future safe deletion needs an approved writer-fencing/retention design and auditable exact-version action; no such product or schema is introduced here.
