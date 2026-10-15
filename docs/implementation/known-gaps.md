# B00 known gaps

- The recovery executor denies `storage.googleapis.com`, needed for some Go
  module downloads during the pinned MinIO source build. Full local execution in
  that executor is therefore unavailable. The full six-service stack, browser,
  failure/recovery, log hygiene and reset/reboot tests **passed on GitHub Actions**.
  See [B00-report.md](B00-report.md) for the tested commit, CI links and the
  distinction between local and remote results. Repeating the full build in the
  recovery executor requires that host in its Allowed Hosts.
- ESLint 9.39.5 is deprecated by npm but matches the Next lint plugins' declared
  peer ranges. Revisit the toolchain when those plugins support ESLint 10; do not
  force an unsupported peer combination.
- Runtime images use exact version tags rather than immutable digests. This is
  a local development bootstrap; production image hardening is not B00 scope.
- Domain integration, DB migration and seed are intentionally unimplemented and
  exit 1. B01 and later tasks are not started.
