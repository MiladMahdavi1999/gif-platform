# B09 local staging deployment and bootstrap

This is a **local, disposable staging** topology, not production infrastructure or a public launch. All runtime processes use production mode, compiled code and source-SHA image tags. Only `127.0.0.1:8443` (Caddy HTTPS) and `127.0.0.1:9443` (MinIO HTTPS signed browser POST) are published. PostgreSQL, API, Web, Worker and MinIO console have no host ports. Runtime proxy variables are explicitly cleared for private-only service traffic; build proxies and CA trust remain separate. The private Docker network has `internal: true`; only edge also joins ingress. FFmpeg retains B04's Landlock/seccomp/rlimit subprocess isolation, fixed argv and network denial; the Worker retains non-root, read-only root, capability drop, no-new-privileges, bounded tmpfs/CPU/memory/PIDs and its restricted DB/S3 identities.

Prerequisites: Docker Engine with Compose v2/BuildKit, OpenSSL, curl, Node 24.19.0, pnpm 10.34.7, clean committed checkout, local ports free, and a Linux host supporting the existing decoder sandbox. Never point this template at another database or bucket. No vendor, cloud account, DNS, registry publication or production credential is configured.

## Build and deploy from a clean checkout

Run from repository root. `work/` is ignored and contains private nonproduction configuration. Do not attach its complete contents to tickets or CI artifacts.

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm exec playwright install --with-deps chromium
pnpm staging init
pnpm staging validate
pnpm staging build
pnpm staging infra
pnpm staging migrate
pnpm staging migrate
pnpm staging empty
pnpm staging provision
pnpm staging bootstrap --authorize-test-identities
pnpm staging start
pnpm staging verify
pnpm staging smoke
```

`init` refuses to replace existing configuration/CA; creates a mode-600 env file, distinct random nonproduction credentials and a seven-day private CA/server certificate for localhost/minio. It starts nothing and creates no users. `validate` refuses an exposed env file, missing/invalid secrets, conflicting identities, foreign targets, non-SHA image tags or missing certificate files. `STAGING_ENV_FILE` may select another private env file; the default is `work/staging.env`. Keep generated paths on the Docker host. The CA private key remains mode 600 outside containers. The mounted server key is readable by service UID 1000 even when the host operator has another UID; its host parent directory is mode 700, so other host users cannot traverse to it. Only Caddy/MinIO receive that key. This staging-only filesystem arrangement requires review before any external secret-delivery design. Only public CA certificates and the server TLS key/certificate are mounted; no source directory is mounted. Docker operators can access environment secrets: this is not an external secrets-manager design.

`build` requires a clean Git tree, explicitly pulls the digest-pinned PostgreSQL runtime, and builds four **local-only** images:

- `gif-platform-staging-app:<40-character-source-SHA>`: compiled API, Next production build and one-shot tools.
- `gif-platform-staging-worker:<SHA>`: same compiled packages plus pinned FFmpeg and decoder sandbox.
- `gif-platform-staging-minio:<SHA>`: security release source commit already selected in B00, with TLS-aware health and guarded IAM provisioning.
- `gif-platform-staging-edge:<SHA>`: pinned Caddy with the staging configuration baked into the image. Its inherited low-port file capability is removed at build time; high port 8443 works with all capabilities dropped and no-new-privileges.

No `latest`, registry push, live source mounts, hot reload or built-in credentials. Node, Go, Caddy and staging PostgreSQL base references are digest-pinned; pnpm/Node/FFmpeg versions and the lockfile are fixed. `work/b09-image-provenance.json` records exact built image IDs, source SHA and lockfile SHA256. Labels bind each image to its source revision. Archive the reviewed local images with `docker save` and record SHA256 if moving between hosts; verify IDs before deployment. A tag alone can be overwritten by an operator; the retained image ID is authoritative. The workflow is reproducible from committed source and pins; it does not claim bit-identical layers across builders/timestamps or permanently available Debian/package repositories. Preserve tested images, rather than rebuilding them during rollback. Runtime images currently retain build dependencies/source for the shared monorepo; image-size minimization and SBOM/vulnerability approval remain production follow-up.

Managed execution environments may need `BUILDX_CONFIG=$PWD/work/buildx` to keep buildx state in the workspace, and `CODEX_PROXY_CERT` for the optional BuildKit `proxy_ca` mount already supported by the Dockerfiles. Never disable TLS verification or copy session proxy credentials/CA into application layers. A denied dependency download is a build blocker, not an instruction to bypass network policy.

## Ordered control plane

1. **Validate configuration** before any Docker action.
2. **Initialize infrastructure** (`infra`): clean named PostgreSQL/MinIO volumes, healthchecks, no app start. It refuses missing or incorrectly labelled app images.
3. **Verify DB availability** through `pg_isready` and an authenticated `SELECT 1` in the one-shot admin process.
4. **Apply migrations** (`migrate`): stops application ingress/services first; invokes the existing checksum-ledger/advisory-lock/transaction migration runner. No SQL history changes, automatic reset or seed. A nonzero exit aborts deployment; do not start apps afterward.
5. **Provision and bootstrap explicitly**: `provision` creates restricted DB/S3 identities and private, versioned buckets; no users/content. `empty` verifies all six inventory counts are zero on the first deployment. `bootstrap --authorize-test-identities` is separate and required to create the configured uploader and distinct reviewer. It requires production+staging mode and exact local DB configuration, rejects conflicting passwords/roles, preserves existing hashes/IDs on replay, and creates no media. This user-requested test bootstrap is not a claim that an actual human reviewed the synthetic fixture; Chromium exercises the distinct authorized human-role persona.
6. **Start apps** (`start`): checks immutable-source labels, exact migration ledger and authenticated bucket/versioning readiness, then enables API/Web/Worker/edge. No automatic migration or bootstrap. The API never receives storage-root or DB-admin credentials; the Worker cannot change visibility/moderation or search/index entitlements.
7. **Verify readiness** (`verify`): verifies TLS with the local CA via curl, HTTP liveness/readiness, Web and Host page, plus fresh restricted Worker dependency-readiness marker. API Docker health is process liveness; Worker liveness and dependency readiness are separate. DB/storage initialization is separate from both. No probe certifies every asset.
8. **Smoke** (`smoke`): real Chromium/HTTP/Worker/FFmpeg journey, with no routed/mocked network responses.

Startup is deliberately controlled by this command sequence; raw `docker compose up` is not the deployment interface. Failed commands exit nonzero; no dependent application start is performed by the controller. On upgrade, back up first, preserve prior image IDs, stop writers, migrate, provision only when necessary, and run readiness/smoke before using the new release. `migrate` and `provision` stop applications; do not run them casually on a live fixture.

## Staging-only security and lifecycle

The browser at `https://localhost:8443` uses Secure/HttpOnly/SameSite cookies and exact Origin/CSRF enforcement. MinIO TLS upload uses `https://localhost:9443` with exact CORS origin. Internal Node/Go S3 clients trust the mounted CA. Playwright accepts this disposable self-signed CA through its staging-only context option; curl verification still checks the CA and hostname. Browser acceptance is never enabled in product runtime. For interactive review, trust only this disposable CA in a separate test browser/profile; remove trust afterward. Do not distribute its private key.

`PUBLIC_MEDIA_CACHE_SECONDS=0` is a staging setting to observe fresh origin revocation. Read/media budgets 300/600 per minute and max concurrency 5 are explicit inherited provisional local limits, not production capacity approval. Server-side peer identity remains socket-based; review distributed/proxy-aware limiting before any public exposure. PostgreSQL requires a column UPDATE privilege for the existing identity row locks. Staging grants only the identity-key columns and installs operator-owned BEFORE UPDATE guards that reject every API identity mutation, including no-op/key reassignment; credential and role columns remain ungranted. These staging-only guard triggers/functions are explicitly provisioned security policy and included in the database backup, not changes to historical schema migrations. DB and S3 role provisioning are staging operator actions and do not alter historical migrations or production IAM.

```sh
pnpm staging inventory
pnpm staging stop
pnpm staging down
```

`stop` and `down` preserve all volumes. There is no destructive reset subcommand. A clean rerun must use a fresh checkout/config/project/certificate directory or explicitly inspect and remove only its recorded disposable volumes after authorized review. Never reuse a contaminated fixture for the clean-volume gate. CI generates a random project on a fresh runner; no seed or pre-existing volume is reused. The restore drill uses another random project and retains its volumes for inspection until runner disposal.

See [smoke evidence](B09-smoke.md), [recovery](B09-recovery.md), [acceptance](B09-acceptance.md), and [release gate](B09-release-gate.md).
