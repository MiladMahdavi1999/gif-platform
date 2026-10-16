import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { animatedGif } from '@gif/testing';
test.use({ trace: 'off', video: 'off' }); // Auth and presigned forms must not be retained.
async function signIn(page: Page, reviewer = false) {
  await page.goto('/login');
  const email =
    process.env[reviewer ? 'DEV_REVIEWER_EMAIL' : 'DEV_UPLOADER_EMAIL'];
  const password =
    process.env[reviewer ? 'DEV_REVIEWER_PASSWORD' : 'DEV_UPLOADER_PASSWORD'];
  if (!email || !password)
    throw new Error('Configured B01 seed accounts required');
  await page.getByLabel('Email', { exact: true }).fill(email);
  try {
    await page.getByLabel('Password', { exact: true }).fill(password);
  } catch {
    throw new Error('Unable to enter configured password');
  }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Signed in as ${email}`);
}
async function choose(page: Page, title: string) {
  await page.goto('/studio/upload');
  await page.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
    name: 'original.gif',
    mimeType: 'image/gif',
    buffer: animatedGif(),
  });
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page
    .getByLabel('Tags (comma separated, optional)')
    .fill('original, browser');
  await page.getByRole('checkbox').check();
}
test('browser uploads directly to localhost:9000, confirms private receipt and persists after refresh and list navigation', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const title = `Owned animation ${randomUUID()}`;
  await choose(page, title);
  const browserFailures: string[] = [];
  page.on('pageerror', (e) => browserFailures.push(e.message));
  const direct = page.waitForResponse(
    (r) =>
      new URL(r.url()).origin === 'http://localhost:9000' &&
      r.request().method() === 'POST',
  );
  const intent = page.waitForResponse('**/api/v1/uploads');
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  expect((await direct).status()).toBe(204);
  // Boolean-only assertions avoid printing secrets if something regresses.
  const form = await (await intent).json();
  expect(Boolean(form.form.fields.Policy)).toBe(true);
  expect(Boolean(form.form.fields['X-Amz-Signature'])).toBe(true);
  const secret = process.env.S3_SECRET_ACCESS_KEY;
  if (!secret)
    throw new Error('Storage secret required for browser leakage check');
  expect(JSON.stringify(form).includes(secret)).toBe(false);
  expect(
    JSON.stringify(form).includes(
      process.env.DATABASE_URL ?? 'missing-sentinel',
    ),
  ).toBe(false);
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Received privately. Processing queued; not processed or published.',
  );
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '100');
  await page
    .getByRole('link', { name: 'View durable private receipt' })
    .click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(
    page.getByText(
      'Received privately. Processing queued; not processed or published.',
      { exact: true },
    ),
  ).toBeVisible();
  const receiptUrl = page.url();
  const assetId = new URL(receiptUrl).pathname.split('/').at(-1)!;
  const response = await page.request.get(`/api/v1/me/assets/${assetId}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).states.visibility).toBe('PRIVATE');
  expect(await page.locator('img,video').count()).toBe(0);
  await page.screenshot({ path: 'test-results/b03-private-receipt.png' });
  await page.goto('/studio/assets');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  for (const path of [
    '/api/v1/public/gifs',
    `/api/v1/public/gifs/${assetId}`,
    `/media/${assetId}/display.gif`,
  ])
    expect((await page.request.get(path)).status()).toBe(404);
  const anonymous = await browser.newContext();
  try {
    const other = await anonymous.newPage();
    expect(
      (await other.request.get(`/api/v1/me/assets/${assetId}`)).status(),
    ).toBe(401);
    expect(
      (
        await other.request.get(`${form.form.url}/${form.form.fields.key}`)
      ).status(),
    ).toBe(403);
    await other.goto(receiptUrl);
    await expect(other.getByRole('main').getByRole('status')).toContainText(
      'Sign in',
    );
    await signIn(other, true);
    expect(
      (await other.request.get(`/api/v1/me/assets/${assetId}`)).status(),
    ).toBe(404);
  } finally {
    await anonymous.close();
  }
  expect(browserFailures).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
test('browser retries completion after lost response without reuploading or duplicating the receipt', async ({
  page,
}) => {
  await signIn(page);
  await choose(page, `Retry original ${randomUUID()}`);
  let posts = 0;
  page.on('request', (r) => {
    if (r.url().startsWith('http://localhost:9000') && r.method() === 'POST')
      posts++;
  });
  let interrupted = false;
  await page.route('**/api/v1/uploads/*/complete', async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Upload not confirmed',
  );
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Received privately. Processing queued; not processed or published.',
  );
  expect(posts).toBe(1);
});
test('upload surfaces anonymous and reviewer denial, validates file type and reports storage failure truthfully', async ({
  page,
}) => {
  await page.goto('/studio/upload');
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Sign in',
  );
  await signIn(page, true);
  await page.goto('/studio/upload');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Uploader access is required.',
  );
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page);
  await choose(page, 'Unavailable storage');
  await page.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
    name: 'bad.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('bad'),
  });
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Choose a nonempty GIF file up to 20 MiB.',
  );
  await page.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
    name: 'original.gif',
    mimeType: 'image/gif',
    buffer: animatedGif(),
  });
  await page.route('http://localhost:9000/**', (route) => route.abort());
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Unable to reach private storage. Retry this upload.',
  );
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Upload not confirmed',
  );
  expect(
    await page
      .getByRole('link', { name: 'View durable private receipt' })
      .count(),
  ).toBe(0);
});
