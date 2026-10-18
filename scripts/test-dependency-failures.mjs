import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

// Run only against this repository's disposable local Compose project.
const compose = (...args) =>
  execFileSync(
    'docker',
    ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml', ...args],
    { stdio: 'inherit' },
  );
const base = 'http://localhost:8080';
async function waitReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${base}/api/v1/health/ready`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    if (response?.status === 200) return;
    await setTimeout(1000);
  }
  throw new Error('Readiness did not recover');
}
function workerProbe(file) {
  return (
    execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env',
        '-f',
        'infra/compose.yaml',
        'exec',
        '-T',
        'worker',
        'node',
        '-e',
        "const fs=require('node:fs');try{process.stdout.write(Date.now()-Number(fs.readFileSync(process.argv[1],'utf8'))<15000?'ready':'not_ready')}catch{process.stdout.write('not_ready')}",
        file,
      ],
      { encoding: 'utf8' },
    ) === 'ready'
  );
}
async function waitWorkerReady(expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (workerProbe('/tmp/gif-worker-ready') === expected) return;
    await setTimeout(500);
  }
  throw new Error(
    expected
      ? 'Worker dependency readiness did not recover'
      : 'Worker dependency readiness incorrectly stayed healthy',
  );
}
await waitReady();
await waitWorkerReady(true);
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
try {
  const page = await browser.newPage();
  await page.goto(base);
  await expect(page.getByRole('status')).toHaveText(
    'Dependencies ready — PostgreSQL and object store reachable',
  );
  await page.screenshot({ path: 'test-results/home-ready.png' });
  for (const [service, check] of [
    ['db', 'database'],
    ['minio', 'storage'],
  ]) {
    try {
      compose('stop', service);
      const response = await fetch(`${base}/api/v1/health/ready`);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.status, 'not_ready');
      assert.equal(body.checks[check], 'down');
      const other = check === 'database' ? 'storage' : 'database';
      assert.equal(body.checks[other], 'up');
      assert.equal((await fetch(`${base}/api/v1/health/live`)).status, 200);
      const publicRead = await fetch(`${base}/api/v1/public/gifs`);
      assert.equal(publicRead.status, service === 'db' ? 503 : 200);
      if (service === 'db') {
        const failure = await publicRead.json();
        assert.equal(
          failure.error.message,
          'Public service unavailable. Please retry.',
        );
        assert.equal(
          publicRead.headers.get('x-request-id'),
          failure.error.requestId,
        );
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(
          page
            .getByRole('region', { name: 'Discover GIFs', exact: true })
            .getByRole('alert'),
        ).toContainText('could not be loaded');
      }
      // Worker readiness must track dependencies; its process heartbeat is liveness only.
      await waitWorkerReady(false);
      assert.equal(workerProbe('/tmp/gif-worker-heartbeat'), true);
      await expect(page.getByRole('status')).toHaveText(
        'Dependencies unavailable',
        { timeout: 15000 },
      );
      await page.screenshot({ path: `test-results/${service}-down.png` });
      console.log(
        `PASS: ${service} stopped -> readiness 503, liveness 200, browser unavailable`,
      );
    } finally {
      compose('start', service);
      await waitReady();
      await waitWorkerReady(true);
    }
    await expect(page.getByRole('status')).toHaveText(
      'Dependencies ready — PostgreSQL and object store reachable',
      { timeout: 15000 },
    );
    console.log(`PASS: ${service} restored -> readiness 200, browser ready`);
    assert.equal((await fetch(`${base}/api/v1/public/gifs`)).status, 200);
  }
  const detailPage = await browser.newPage();
  try {
    compose('stop', 'api');
    const response = await fetch(`${base}/api/v1/health/live`);
    assert.equal(response.status, 502);
    assert.equal((await fetch(base)).status, 200);
    await expect(page.getByRole('status')).toHaveText(
      'API unavailable or health response invalid',
      { timeout: 15000 },
    );
    await page.screenshot({ path: 'test-results/api-down.png' });
    await detailPage.goto(`${base}/g/${randomUUID()}`);
    await expect(
      detailPage.getByRole('heading', {
        name: 'GIF service unavailable',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      detailPage.locator('meta[name="robots"]').first(),
    ).toHaveAttribute('content', /noindex/);
    await detailPage.screenshot({
      path: 'test-results/b06-detail-api-down.png',
    });
    console.log(
      'PASS: API stopped -> edge 502, home still renders, browser unavailable',
    );
  } finally {
    compose('start', 'api');
    await waitReady();
  }
  await expect(page.getByRole('status')).toHaveText(
    'Dependencies ready — PostgreSQL and object store reachable',
    { timeout: 15000 },
  );
  await detailPage
    .getByRole('button', { name: 'Retry detail', exact: true })
    .focus();
  await detailPage.keyboard.press('Enter');
  await expect(
    detailPage.getByRole('heading', { name: 'GIF unavailable', exact: true }),
  ).toBeVisible();
  await expect(
    detailPage.locator('meta[name="robots"]').first(),
  ).toHaveAttribute('content', /noindex/);
  await detailPage.close();
  console.log(
    'PASS B06: real API outage detail error/noindex and keyboard retry after recovery to truthful not-found',
  );
  console.log('PASS: API restored -> readiness 200, browser ready');
} finally {
  await browser.close();
}
