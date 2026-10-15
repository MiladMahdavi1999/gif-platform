# B01 — Core SQL schema, migrations and development seed

Session date: 2026-10-16 (Asia/Tehran). Scope: **B01 only. B02 NOT STARTED.**

## Baseline and scope

Latest main was verified at `eba9ad62141fe625d83a75b606da5b7f1de73863`, the merge
of [B00 PR #1](https://github.com/MiladMahdavi1999/gif-platform/pull/1).
B00's report and retained successful CI evidence were read before implementation.
Branch: `codex/b01-core-database`. All seven original architecture/governance
reference documents remain unchanged.

## Delivered behavior and files

- `packages/db/src/schema.ts`, Drizzle config and committed migrations/snapshots:
  all 13 normative tables, foreign keys, unique constraints, state/value CHECKs,
  UTC timestamps, UUID defaults and required indexes. Tables: users, role_grants,
  sessions, assets, tags, asset_tags, asset_states, upload_sessions,
  asset_variants, moderation_decisions, search_documents, media_jobs, audit_events.
- `migrate.ts`: transactional SQL runner consuming the Drizzle version journal,
  advisory locking and an immutable SHA-256 ledger in `gif_migrations.history`.
  Repeated/concurrent runs preserve data; history drift refuses to run.
- `dev.ts`, `reset.ts`, `cli.ts`, development rollback SQL and command wrappers:
  distinct uploader/reviewer seed with Argon2id; explicit development-only mode,
  opt-in, local-target checks and reset confirmation; sanitized CLI output.
- `packages/domain`: seven independent axis types plus moderation, pure guarded
  transitions and normalized tags. No route, feature persistence command, session
  login, worker processing or public search is implemented.
- PostgreSQL integration/unit tests, tooling/test Compose overlays, CI database
  job, `.env.example`, pinned dependency lockfile, README commands and this report.
- The existing lifecycle test now requires development settings and exact reset
  confirmation, and also checks logs for the two seed passwords.

## Provisional implementation choices

1. Drizzle ORM **0.45.4**, Drizzle Kit **0.31.11**, `@node-rs/argon2` **2.2.2**.
   Argon2id uses 19 MiB, two passes, one lane and library-generated random salts.
   Kit generates SQL/snapshots; a small transaction runner adds history drift
   rejection and serialization. Do not run an alternate migrator/ledger.
2. Audit writes remain append-only through a statement trigger covering UPDATE,
   DELETE and TRUNCATE, plus PUBLIC privilege revocation. A schema-owning
   administrator can still change DDL; production role provisioning/hardening is
   deferred to the deployment task, not claimed here.
3. Added positive row_version/job generation/optional upload size checks and
   lowercase/trimmed tag validation. The domain guard caps tags at ten and rejects
   duplicates. These refine the spec's stated integrity rules without changing it.
4. Seed repeats preserve existing IDs/hashes and reject conflicting role grants;
   passwords are never reset by seeding. Both users must be distinct and passwords
   must be supplied through local development configuration. No seed at startup.
5. Development tools are an explicit Compose profile, separate from production-mode
   API containers. An isolated PostgreSQL test overlay provides a disposable
   test dependency; tests create/drop their own random database.
6. Pure moderation guards require REVIEWER, disallow self-review and check version,
   reason and approval prerequisites. ADMIN delegation remains unimplemented as
   the spec reserves it for later. HTTP auth/CSRF and feature transactions remain
   the responsibility of their later backlog tasks.

## Actual execution results

Local commands use `work/pnpm`, an ignored wrapper placing the downloaded pinned
pnpm **10.34.7** on PATH. This avoids the executor's incompatible system pnpm
11.25.0. It is equivalent to the README's `npx --yes pnpm@10.34.7` commands.
Network-enabled execution is needed even for local listener/database tests in
this sandbox. No policy bypass or TLS disabling was used.

| Command                                                                           | Actual result                                                           |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pinned `pnpm install`                                                             | PASS; lockfile updated with exact direct pins                           |
| `pnpm typecheck`                                                                  | PASS                                                                    |
| `pnpm lint`                                                                       | PASS                                                                    |
| `pnpm test`                                                                       | PASS, 50 unit tests at initial verification; final count recorded below |
| `pnpm build`                                                                      | PASS, API/worker/packages and Next production build                     |
| `pnpm db:check`                                                                   | PASS                                                                    |
| `pnpm db:generate` after generation                                               | PASS, no schema changes                                                 |
| `TEST_DATABASE_URL=… ALLOW_DATABASE_INTEGRATION_TESTS=true pnpm test:integration` | PASS, 13 tests against real PostgreSQL 17.6                             |
| Original seven document comparison                                                | PASS, unchanged against main                                            |
| Full B00/B01 GitHub Actions                                                       | Pending execution on PR; updated evidence follows                       |
| Local full Compose/browser/failure/lifecycle checks                               | NOT RUN yet; remote CI runs these gates                                 |

The integration suite verifies all 15 foreign keys independently, key uniqueness,
all enum CHECK sets, scalar validation, two distinct roles and Argon2id verify,
migration/seed replay without deleting data or changing hashes, FTS title/tag/
Unicode queries and generated updates, GIN query plan, immutable audit, changed
history refusal, transactional failure rollback, concurrent migrators, production
seed/inspect/reset refusal, and reset/remigrate/reseed.

Initial development runs failed on a BigInt Drizzle default serialization and a
BigInt test-name formatter; these were corrected using an SQL default and a
non-JSON test label. The first DB run passed its assertions but failed teardown
because forced DROP raced connection shutdown; removing FORCE fixed the error.
An initial restricted-network unit invocation could not open loopback listeners;
rerunning with the sandbox's supported network capability passed. These initial
failures are not represented as successful runs.

## Unexecuted / later-task boundaries

Authentication, CSRF, upload/S3 operations, job claims/leases, atomic moderation
persistence, public search/delivery and picker workflows are NOT RUN because
B02+ is outside this PR. B00's negative HTTP test still verifies product routes
are absent. No external media fixtures or Host action endpoints were added.

Final CI links, final verification counts and any blockers will be appended after
observing the actual PR checks. No merge is authorized or performed.

**B02 NOT STARTED.**
