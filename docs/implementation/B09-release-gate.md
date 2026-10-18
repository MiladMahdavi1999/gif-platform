# B09 release gate

## A — First Buildable Slice technical acceptance

**NOT VERIFIED pending B09 execution.** The [exact SL-AC matrix](B09-acceptance.md) is the closure gate. Passing design reviews or historical B08 runs alone does not close B09. Require the same reviewed tree's formatting/lint/typecheck/production build, unit, database/storage/FFmpeg/auth/permission/security/recovery/log-hygiene, contract/schema/migration checks, Chromium suite and clean production-staging flow. Any stop-the-line failure blocks acceptance; no test may silently skip or reuse contaminated fixtures.

## B — Local staging readiness

**NOT VERIFIED pending the clean-image smoke and restore drill.** Readiness is limited to this local, single-host, production-mode, loopback-only staging template and synthetic identities/media. Require explicit configuration, versioned images, no automatic user/content seed, controlled migration/bootstrap/start sequence, dependency readiness, the real smoke and executed recovery evidence. A successful restore drill demonstrates this fixture's paired DB/object-version snapshot, not a comprehensive disaster-recovery service or rollback guarantee for future schema versions.

## C — Production/public-internet launch readiness

**BLOCKED.** A or B never implies C. No public deployment, hosting purchase, registry publication, merge or auto-merge is authorized by this package. Required follow-up owners and approvals:

| Blocker                                                 | Required approval / responsible follow-up                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rights attestation is only a local assertion            | Product/legal: licensed supply basis, terms, rights-holder/takedown process, commercial redistribution authority                                                                 |
| Privacy, account data, originals and moderation records | Privacy/legal/security: data classification, consent, minimization, access, retention/deletion including versioned objects/backups, region/transfer policy                       |
| Auth and reviewer entitlement/operations                | Security/trust operator: credential provisioning/rotation, reviewer assignment, least privilege, access review, incident response, actual human moderation policy/staffing       |
| Internet threats and decoder/software supply chain      | Security: threat review, vulnerability/SBOM/dependency and container approval, isolation validation on chosen host; no claim of universal GIF safety                             |
| Infrastructure/vendor/license choices                   | Infrastructure/legal: selected hosting/object vendor/region, MinIO license/redistribution obligations if selected, TLS/domain/ingress/network controls and supported runtime     |
| Capacity and abuse controls                             | Engineering/security: reviewed real traffic/resource limits, distributed rate limiting and trusted proxy peer identity; current per-process socket-peer controls are provisional |
| Media revocation and cache                              | Product/legal/security: approved cache/revocation semantics, downstream-copy limitation and any CDN purge design; no instant global deletion claim                               |
| Backups, recovery and operations                        | Operations/privacy: encrypted/off-host backups, retention/access/monitoring, RTO/RPO objectives, recovery ownership and repeated drills, post-backup takedown reconciliation     |
| Migration/image compatibility                           | Engineering/operations: approved forward migration strategy, tested prior/current image compatibility and rollback plan for each real schema release                             |
| Public developer product and governance                 | Product/owner: supported external API/versioning/quotas if desired; Phase 02/03 formal approval trace and remaining inherited governance gaps                                    |

All new B09 local mechanics (seven-day local CA, exact loopback ports, generated staging accounts, cold MinIO volume archive, budgets/cache settings, shared runtime image footprint) remain provisional engineering choices for human review. No canonical decision register is changed. Proposed separate governance action after evidence review: the owner may record acceptance of B09/local staging and the First Buildable Slice with these limits; leave production/public launch blocked and the larger 12-phase project open. This is a proposal only.
