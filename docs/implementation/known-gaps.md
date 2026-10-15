# B00 known gaps

- Full B00 acceptance is blocked: the managed environment denies
  `storage.googleapis.com`, needed for the pinned MinIO source build's Go module
  downloads. Six-service healthy boot, ready 200, healthy browser and full
  dependency recovery are unverified. See [B00-report.md](B00-report.md) for actual
  executed commands and the distinction between partial and full-stack results.
- ESLint 9.39.5 is deprecated by npm but matches the Next lint plugins' declared
  peer ranges. Revisit the toolchain when those plugins support ESLint 10; do not
  force an unsupported peer combination.
- Runtime images use exact version tags rather than immutable digests. This is
  a local development bootstrap; production image hardening is not B00 scope.
- Domain integration, DB migration and seed are intentionally unimplemented and
  exit 1. B01 and later tasks are not started.
