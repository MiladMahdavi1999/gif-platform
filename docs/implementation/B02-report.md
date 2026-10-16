# B02 — Session login, CSRF and role authorization

Task: B02 only. B03 NOT STARTED. Status: implementation complete; verification
and PR evidence being collected. No merge is authorized or performed.

## Starting point and scope

Fetched latest `origin/main` and created `codex/b02-session-auth` from
`17335ec937e8bedcc2b9c00900e3748cf14bbe31`. Confirmed merged B00 PR #1
(`eba9ad6`) and B01 PR #2 (`17335ec`) through both git history and GitHub metadata.
Read all seven Phase 03 references and inspected existing health, configuration,
Drizzle schema, SQL migrations, Argon2id seed, domain guards, Compose and CI.
The seven architecture documents and original governance documents are unchanged.

## Changed files / rationale

- `packages/db/src/auth.ts`, `index.ts`: Auth-owned PostgreSQL repository over
  existing users/role_grants/sessions. No schema change. Argon2id verification,
  dummy verification for absent accounts, transactional rotation and revocation.
- `apps/api/src/auth.ts`, `app.ts`, `main.ts`: three auth endpoints, principal and
  explicit role middleware, reviewer access stub, Origin/Fetch Metadata/CSRF,
  bounded retry guard, sanitized HTTP errors and secret header redaction.
- `packages/contracts/src/index.ts`, `scripts/generate-openapi.mjs`,
  `docs/api/openapi.json`, `package.json`: strict shared DTOs and generated
  OpenAPI 3.1 for implemented health/auth/review routes, with drift checking.
- `packages/config/src/index.ts`, `.env.example`, `infra/compose.yaml`: cookie
  name/TTL, exact origin validation and production HTTPS enforcement. Explicit
  development mode for the local HTTP API; production web/worker preserved.
- `apps/web/app/login/*`, `review/route.ts`, `page.tsx`, `style.css`: validated
  login, pending/error states, session restore, logout and uncached reviewer
  check with real HTTP 401/403/200; no web DB access.
- Auth unit, PostgreSQL API integration and browser tests; runtime log hygiene
  script; CI runs auth/browser/security and all existing B00/B01 checks.
- README and this implementation report document operation and limitations.

## Security behavior and Provisional choices

- Independent 32-byte CSPRNG bearer token for every successful login; SHA-256
  hashes only in PostgreSQL. Previous cookie session revoked in the same
  transaction as replacement. Logout revokes before clearing the cookie.
- CSRF token derived with domain-separated HMAC-SHA-256 keyed by the bearer
  token, hash persisted in existing `csrf_token_hash`. This permits stable
  restoration after refresh without storing plaintext CSRF or an additional
  server secret. CSRF hash comparisons use `timingSafeEqual`.
- Server rechecks ACTIVE account, expiry, revocation and current roles on every
  authenticated request. Absolute configured expiry; no sliding extension.
- Host-only HttpOnly/Lax/Path=/ cookie, Max-Age and Expires. Secure on HTTPS;
  HTTP accepted only with NODE_ENV=development at the config boundary.
- Unsafe requests require exact Origin and reject cross-site/same-site Fetch
  Metadata. Login requires JSON and strict fields (login-CSRF protection).
  Other authenticated unsafe routes require a session-bound X-CSRF-Token.
  No credentialed cross-origin CORS is enabled.
- Password/unknown/disabled account errors have identical status/code/message.
  Absent users still run a dummy Argon2id verification with B01 seed parameters.
  Malformed input is 400; rate limits are independent of account existence.
- Provisional limits: 10 account / 50 peer IP attempts per 15 minutes, bounded
  10000 entries; capacity exhaustion fails closed. Process-local, no forwarded
  headers trusted. Behind Caddy the peer budget is shared. Distributed limits
  and an explicit proxy trust policy remain deployment work.
- REVIEWER must be explicitly granted; ADMIN implies no moderation delegation.
  `/review` is a static-message access check; no moderation workflow/actions.
- Auth browser traces/videos disabled. Runtime logging avoids request bodies,
  cookies, CSRF headers and Set-Cookie. Log hygiene checks dynamic session/CSRF
  values and B01 seed/infrastructure passwords without printing them.

## Commands executed and actual results

Local environment: Node 24.19.0, pinned pnpm 10.34.7 via Corepack. The executor's
home is read-only, so Corepack/pnpm/cache/buildx paths were placed under ignored
`work/`; no home-directory changes. Shell network/Docker access needed the
scoped network-enabled execution setting; initial default-sandbox attempts
failed and are not counted as passing tests.

- `git fetch origin`; branch creation from latest main: PASS.
- `pnpm install --frozen-lockfile --store-dir /workspace/gif-platform/work/store`:
  PASS after setting workspace-local Corepack/pnpm cache paths.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`: PASS
  on the first complete verification run; 58 unit tests (all 51 B00/B01 retained).
- `docker compose -f infra/compose.db-test.yaml up -d --wait`: PASS, real
  PostgreSQL 17.6, disposable local dependency.
- `TEST_DATABASE_URL=postgresql://gif_platform:local_only_integration_password@127.0.0.1:55432/gif_platform_test ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration`:
  PASS, 23 tests (13 B01 + 10 B02), isolated migrated/seeded databases.
- Initial validator ordering and test dependency-location errors were corrected;
  reruns above passed. No failing attempt is represented as a successful check.

Full-stack/browser and final CI results: pending execution. This report will be
updated with observed results and URLs before delivery.

## Remaining gaps / risks

Production account provisioning, registration, reset/recovery, MFA, distributed
rate limits, session-row retention/cleanup and production operator policy remain
outside B02. Expired/revoked rows cannot authenticate, even before cleanup.
No production exposure or complete first-slice readiness is claimed.

Next unstarted task: **B03 NOT STARTED.**
