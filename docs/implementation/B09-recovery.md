# B09 backup, restore, migration and image rollback

Scope: disposable **local staging** and its exact private PostgreSQL/MinIO volumes. No disaster-recovery guarantee, numeric RTO/RPO, cross-region replication, external storage retention policy or production approval is asserted. Executed evidence is tracked in [B09 report](B09-report.md); procedures below are not evidence by themselves.

## Quiescent backup and consistency

```sh
pnpm staging backup
```

The default destination `work/staging-backup/` must not exist. Optional explicit destination: `pnpm staging backup work/another-private-backup`. The controller stops edge/Web/API/Worker, then stops MinIO, allowing Docker's graceful stop deadline before any snapshot. This fences browser signed POSTs as well as application writes; merely pausing the Worker is insufficient. PostgreSQL remains up, with no application writers. Operators must prevent concurrent direct SQL/storage/Docker administrative writes during the procedure. If exclusive control cannot be established, abort; a point-in-time consistency guarantee cannot be inferred.

`pg_dump -Fc` captures the entire staging database including checksum migration history, upload version receipts, derivative pins, jobs, moderation and append-only audit. A capability-free UID-1000 helper streams the stopped MinIO volume through a private host file descriptor, without mounting the host backup directory or assuming the operator shares the container UID. The volume is archived in its entirety, including hidden `.minio.sys`, bucket configuration, IAM, all object versions and delete markers. This preserves **exact version IDs**; copying latest objects into another bucket would generate different IDs and break the database's version pins. The manifest records hashes of both files, the source project/revision, and a safe SHA256 fingerprint/count of all versions/delete markers. Before the cold snapshot, the bounded operator verifier checks every completed source receipt by exact version/ETag/size and every derivative by exact version/size/SHA256. It fails on truncated inventory or more than 100 fixture pins/versions per category. The private archive contains credentials/password hashes/account data/private originals: directory mode 700, dump/manifest mode 600, never a shared CI artifact. Retain backup encryption/access/expiry decisions for human approval before operating outside a disposable fixture. Services remain stopped after success or failure. Check the backup command's exit and manifest before proceeding.

A database dump alone is not a media backup. An object snapshot alone is not authorization history. Independent live snapshots can refer to absent versions, lose receipts or resurrect revoked content. Do not purge/expire old versions, quarantine, rejected derivatives or audit in B09. Preserve required versions and permission decisions together. The safe orphan inspection from B08 remains detection-only; this runbook authorizes no global/object deletion.

## Safe restore drill

After a successful real smoke and backup:

```sh
pnpm staging restore-drill
```

The controller validates both SHA256 values, creates a **new random disposable Compose project**, restores the cold complete MinIO archive to its new volume, starts infrastructure, and pipes the custom PostgreSQL dump to:

```text
pg_restore -U gif_staging_admin -d gif_platform_staging --exit-on-error --single-transaction --no-owner --no-acl
```

It never drops/resets the source database. The new database is empty and owned by the staging admin. Roles are provisioned explicitly afterward, because pg_dump does not capture cluster roles and `--no-acl` avoids depending on absent role grants. Provisioning reapplies the historical processing-function boundary: revoke default PUBLIC/API execute and grant only the restricted Worker. Start verifies this ACL; the integration test simulates the default execute grant that a no-ACL restore would otherwise reintroduce. The migration runner must then be a no-op against restored checksums. The same exact source/derivative pin checks and complete version/delete-marker inventory fingerprint must match the pre-snapshot evidence; the smoke deliberately creates a noncurrent source version by replaying the signed form after immutable receipt completion. Start, verify TLS/API/Worker readiness, authenticate as the configured reviewer, and compare exact derivative bytes/hashes through private authenticated previews (these routes resolve original DB version pins). Verify unchanged approval/removal actor/action and audit history, plus 404 for removed detail and both public aliases. `work/b09-restore-evidence.json` records only safe outcomes and the disposable project name. The restored project is stopped afterward, with volumes retained. Backups and private version IDs are not uploaded.

A failed restore leaves the source untouched and a partial **disposable target** for inspection. Do not route traffic to it. Record the project from safe Compose output; stop it explicitly through the same private config/project. Diagnose checksum failure, missing versions, PostgreSQL incompatibility, disk limits or role mismatch, then create another fresh target after correcting the procedure. Never resume application service on partially restored data. Do not extract untrusted tar files; this archive is generated from the controlled fixture and integrity checked, not an upload/restore product.

This cold-volume method requires compatible MinIO runtime/layout and a complete stopped filesystem snapshot; it does not establish portability across object vendors or arbitrary MinIO versions. Production recovery needs reviewed immutable/off-host/encrypted backups, retention/access policy, restore ownership, resource capacity and repeated drills. Restoring an older backup can lose a later takedown: before any exposure, reconcile all post-snapshot moderation/rights decisions from a trustworthy retained incident/audit source; if unavailable, keep public access disabled. Already downloaded/cached bytes cannot be recalled.

## Failed migration/deployment

The migration runner takes a database-wide transaction advisory lock, validates the contiguous name/checksum ledger, and applies pending SQL and ledger inserts in **one transaction**. Approved historical SQL is unchanged. Existing integration tests inject invalid DDL and verify no partial table or ledger commit; edited/missing migration history is rejected. A migration error exits nonzero and application services remain stopped. PostgreSQL interruption/uncertain outcome requires reconnecting, inspecting the ledger and rerunning the unchanged idempotent migration command; do not assume success from a dropped connection or edit checksums to force green.

Preserve safe error classification, image IDs, migration ledger and command exit status in an incident record; do not print connection strings, row detail, rejected SQL values or storage keys. Diagnose against a disposable clone if needed. Resolve schema changes by a reviewed forward migration. There is **no production down-migration or implicit destructive reset**. B01's development reset/rollback SQL is not a staging rollback procedure. Restore is only justified after data-loss/takedown implications are assessed and writers are fenced.

If failure precedes any migration commit, restore the prior compatible images and configuration after confirming unchanged migration ledger. If schema has changed, establish old-image compatibility against a restored clone first. No deployed schema may be destructively reverted just to fit an old app image. Expand/migrate/contract evolution and explicit compatibility windows are required for future schema releases.

## Application image rollback

Retain the previous reviewed `APP_IMAGE`, `WORKER_IMAGE`, `EDGE_IMAGE`, local image IDs and configuration privately. Stop ingress and application writers. Verify that the current schema, job generation semantics and exact object-version pins remain compatible with **all** previous components. In the private env file, set the prior SHA tags; confirm `docker image inspect <tag>` matches recorded IDs/source labels. The controller refuses missing or incorrectly labelled images:

```sh
pnpm staging stop
# Operator selects the previous reviewed image identifiers in the private env.
pnpm staging validate
pnpm staging start
pnpm staging verify
```

Run recovery checks on a disposable restored copy before enabling a rollback against real data. Never rebuild/re-tag an image and claim it is the previously tested artifact. Do not downgrade MinIO/PostgreSQL during application rollback; restore their compatible storage/runtime pair only through a separate reviewed recovery plan. Worker fencing, lease expiry and bounded retries apply across process restarts. No force completion, manual approval, reset of attempts or unfenced job repair is introduced.

The B09 automated drill verifies restore/restart of one release with intact decisions and byte pins. **Cross-release application rollback is a documented procedure, not an executed claim** unless a specific prior/current image pair and compatibility evidence are recorded in the report. It cannot certify reversibility of future migrations.
