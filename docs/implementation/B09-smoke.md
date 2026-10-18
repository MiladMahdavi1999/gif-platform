# B09 real staging smoke and evidence

Run the clean sequence in [staging deployment](B09-staging.md), including explicit test identity bootstrap, then `pnpm staging smoke`. The source is `tests/staging/journey.spec.ts` with `playwright.staging.config.ts`. It runs Chromium against actual Caddy/production Web/API, PostgreSQL, private TLS MinIO and the real restricted Worker/FFmpeg. It does not intercept, fulfill or mock requests. The two credentials represent separate authorized uploader and human-role moderator accounts; automated UI interaction is not an actual human policy review or legal approval.

The single test asserts the ordered journey:

1. Empty public platform and live/ready health; separate `staging empty` verifies zero users/assets before explicit bootstrap.
2. Uploader login; real Secure/HttpOnly/SameSite cookie.
3. Rights-attested owned-pixel synthetic GIF direct presigned POST to TLS MinIO, durable private receipt, anonymous original-object GET denied.
4. Worker success; pending/private/non-indexed states; public detail/media/search denied.
5. Authorized signed-form replay creates a newer private source version while the receipt stays pinned to its original; exact upload-complete replay preserves logical ID; uploader approval is 403; no decision mutation.
6. Distinct reviewer login; private GIF/poster bytes and browser decoding; explicit approval through the review UI; one reviewer decision and transactional approval audit.
7. All public eligibility axes; actual search and rendered detail; both sanitized media aliases work; original remains private; safe response schemas validate and credentials/private pins do not appear in DTOs.
8. Actual `/demo/host-picker`, search/select; one callback and exact message **Selected; no host action performed.** No write/send/post request from the Host browser.
9. Real Escape/Cancel, including Escape from a nonempty native search field, focus restoration and accessible no-match search.
10. Hold a real Picker card across authorized takedown. New public search, API detail, Web detail, display/poster origin GETs return empty/404. Stale selection reauthorization fails without callback. Approval/removal decision and audit history remain.
11. The same owner then receives a typed `MEDIA_NOT_ANIMATED` private failure, starts a distinct new valid upload, and observes new pending/private derivatives; no automatic approval.

Synthetic fixture generation is `packages/testing/src/index.ts`; no third-party media is fetched. Fresh origin checks use staging cache TTL zero; the test does not promise revocation of cached/downloaded copies.

Safe evidence paths generated only by executed commands:

- `work/b09-image-provenance.json`: immutable image IDs/source/lockfile hash.
- `work/b09-smoke-evidence.json`: outcomes, synthetic title/public asset ID, derivative SHA256, decision actor/action and audit event types. No object keys/version IDs or tokens.
- `work/b09-staging-playwright.json`: actual count/outcome and safe step messages; no tracing/video/request-body attachments.
- `work/b09-picker-selected.png`: public synthetic selection receipt.
- `work/b09-service-safe.log`: actual service logs, shared only after credential/path/token-field checks pass.
- `work/b09-log-hygiene.json`: inspected production-staging service log count and credential/private-path/token-field absence; unchecked raw logs are never uploaded.
- `work/b09-restore-evidence.json`: executed disposable restore checks.

The `b09-staging-safe-evidence` CI artifact uploads only the explicitly named safe files. No env, CA private key, backup, raw SQL dump, MinIO archive, cookies, presigned form or complete work directory is uploaded. A passing job requires all five JSON evidence files to be present. `check-test-gates.mjs` rejects conditional/skip/only/todo tests and staging network mocks. Screenshots alone are not acceptance proof; status/result/commands must agree.

See the [report](B09-report.md) for actual run links/counts and [acceptance matrix](B09-acceptance.md) for remaining verification. A procedure that has not run is NOT VERIFIED, even if the script exists.
