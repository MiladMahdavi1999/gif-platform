import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const original = JSON.parse(
  readFileSync('work/b09-smoke-evidence.json', 'utf8'),
);
const origin = 'https://localhost:8443';
try {
  const login = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.BOOTSTRAP_REVIEWER_EMAIL,
      password: process.env.BOOTSTRAP_REVIEWER_PASSWORD,
    }),
  });
  if (login.status !== 200) throw new Error();
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  await login.body?.cancel();
  const response = await fetch(
    `${origin}/api/v1/review/assets/${original.assetId}`,
    { headers: { cookie } },
  );
  const detail = await response.json();
  if (
    response.status !== 200 ||
    JSON.stringify(
      detail.decisions.map((d) => ({
        action: d.action,
        reviewerId: d.reviewerId,
      })),
    ) !== JSON.stringify(original.decisions) ||
    JSON.stringify(
      detail.audit.map((e) => ({
        eventType: e.eventType,
        actorUserId: e.actorUserId,
      })),
    ) !== JSON.stringify(original.audit)
  )
    throw new Error();
  for (const [variant, digest] of Object.entries(original.derivativeSha256)) {
    const media = await fetch(
      `${origin}/api/v1/review/assets/${original.assetId}/media/${variant}`,
      { headers: { cookie } },
    );
    if (
      media.status !== 200 ||
      createHash('sha256')
        .update(Buffer.from(await media.arrayBuffer()))
        .digest('hex') !== digest
    )
      throw new Error();
  }
  for (const path of [
    `/api/v1/public/gifs/${original.assetId}`,
    `/media/${original.assetId}/display.gif`,
    `/media/${original.assetId}/poster.png`,
  ]) {
    const denied = await fetch(`${origin}${path}`);
    await denied.body?.cancel();
    if (denied.status !== 404) throw new Error();
  }
  console.log(
    'PASS: restored exact derivative hashes/versions via authenticated preview, identical decision/audit trail, and removed-media denial',
  );
} catch {
  console.error('Recovery verification FAILED (private details suppressed)');
  process.exitCode = 1;
}
