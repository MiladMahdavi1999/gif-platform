import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { animatedGif } from '@gif/testing';
test.use({ trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });
// Reuse authentication across these serial owner checks so B07's additional
// real-flow login fits the unchanged per-account authentication retry budget.
let uploaderContext: BrowserContext;
test.beforeAll(async ({ browser }) => {
  uploaderContext = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  const page = await uploaderContext.newPage();
  await login(page);
  await page.close();
});
test.afterAll(async () => {
  await uploaderContext?.close();
});
const compose = (...args: string[]) =>
  execFileSync(
    'docker',
    ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml', ...args],
    { stdio: 'pipe' },
  );
async function login(page: Page) {
  await page.goto('/login');
  const email = process.env.DEV_UPLOADER_EMAIL!;
  const password = process.env.DEV_UPLOADER_PASSWORD!;
  if (!email || !password)
    throw new Error('Configured local accounts required');
  await page.getByLabel('Email', { exact: true }).fill(email);
  try {
    await page.getByLabel('Password', { exact: true }).fill(password);
  } catch {
    throw new Error('Unable to enter configured password');
  }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Signed in as ${email}`);
}
async function upload(page: Page, bytes: Buffer, title: string) {
  await page.goto('/studio/upload');
  await page
    .getByLabel('Animated GIF (up to 20 MiB)')
    .setInputFiles({ name: 'owned.gif', mimeType: 'image/gif', buffer: bytes });
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'View durable private receipt' })
    .click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}
test('owner polls truthful pending then processed private status after real worker restart and refresh', async () => {
  const page = await uploaderContext.newPage();
  test.setTimeout(60000);
  compose('stop', 'worker');
  try {
    await upload(page, animatedGif(), `B04 original animation ${randomUUID()}`);
    await expect(
      page.getByText(
        'Received privately. Processing queued; not processed or published.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText('QUEUED', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/b04-pending.png' });
  } finally {
    compose('start', 'worker');
  }
  await expect(page.getByText('SUCCEEDED', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText(
      'Processing succeeded. Private derivatives are ready for human moderation; not published.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE', { exact: true })).toBeVisible();
  expect(await page.locator('img,video').count()).toBe(0);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const receipt = await (
    await page.request.get(`/api/v1/me/assets/${id}`)
  ).json();
  expect(receipt.variantsReady).toBe(true);
  expect(JSON.stringify(receipt)).not.toMatch(
    /objectKey|objectVersion|quarantine\/|https?:\/\//,
  );
  const publicList = await page.request.get('/api/v1/public/gifs');
  expect(publicList.status()).toBe(200);
  expect(
    (await publicList.json()).items.some(
      (item: { id: string }) => item.id === id,
    ),
  ).toBe(false);
  for (const path of [`/media/${id}/display.gif`, `/media/${id}/poster.png`])
    expect((await page.request.get(path)).status()).toBe(404);
  await page.screenshot({ path: 'test-results/b04-success-private.png' });
  await page.close();
});
test('owner sees real terminal decode failure after refresh with no private URL or decoder output', async () => {
  const page = await uploaderContext.newPage();
  const gif = animatedGif();
  const still = Buffer.concat([
    gif.subarray(0, gif.length - 24),
    Buffer.from([0x3b]),
  ]);
  await upload(page, still, `B04 owned static GIF ${randomUUID()}`);
  await expect(page.getByText('FAILED_TERMINAL', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'MEDIA_NOT_ANIMATED',
  );
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'MEDIA_NOT_ANIMATED',
  );
  await expect(
    page.getByText(
      'Processing failed. This file cannot be processed. Start a new upload; nothing is published.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.locator('img,video').count()).toBe(0);
  await page.screenshot({ path: 'test-results/b04-error-private.png' });
  await page.close();
});
