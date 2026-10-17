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
- The original B00 database placeholders were replaced and verified in B01.
  B02 now supplies authentication; later media workflows remain unimplemented.
- B02 login rate limits are bounded and process-local. Shared limits and a
  reviewed proxy trust policy remain prerequisites for multiple API instances.
  Production provisioning, session retention and operator policy are outside
  this task. See [B02-report.md](B02-report.md) for current execution evidence.

## B04 update

B04 adds the durable lease worker, constrained FFmpeg processing and verified private derivatives. Local MinIO source build remains blocked by the executor network policy; the B04 report distinguishes local PostgreSQL/decoder checks from full CI MinIO/browser evidence. Production identity provisioning, patched decoder maintenance and audited orphan/retention cleanup remain operational gaps. No content is approved or public. See [B04-report.md](B04-report.md). B05 NOT STARTED.

## B06 update

The B00/B04 frontier statements above are historical. B05 moderation and B06
public search, gallery/detail and policy-gated sanitized media are implemented
and passed full CI. See [B06-report.md](B06-report.md) and its retained evidence
for exact results and local-versus-CI distinctions. Local MinIO compilation is
still blocked by the executor network policy; full real storage/browser/lifecycle
verification ran in CI. Client-cached/downloaded bytes cannot be recalled, FTS
is keyword/tag-based, creator labels are pseudonymous, and production identity,
rights, retention, decoder maintenance and capacity work remain open. B07 NOT STARTED.
