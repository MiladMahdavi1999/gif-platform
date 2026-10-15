import assert from 'node:assert/strict';
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
await waitReady();
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
    }
    await expect(page.getByRole('status')).toHaveText(
      'Dependencies ready — PostgreSQL and object store reachable',
      { timeout: 15000 },
    );
    console.log(`PASS: ${service} restored -> readiness 200, browser ready`);
  }
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
  console.log('PASS: API restored -> readiness 200, browser ready');
} finally {
  await browser.close();
}
