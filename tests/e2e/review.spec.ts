import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { animatedGif } from '@gif/testing';
test.use({ trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial' });
let uploaderContext: BrowserContext;
test.beforeAll(async ({ browser }) => {
  uploaderContext = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  const page = await uploaderContext.newPage();
  await login(page, 'UPLOADER');
  await page.close();
});
test.afterAll(async () => {
  await uploaderContext?.close();
});
async function login(page: Page, role: 'UPLOADER' | 'REVIEWER') {
  const email = process.env[`DEV_${role}_EMAIL`];
  const password = process.env[`DEV_${role}_PASSWORD`];
  if (!email || !password)
    throw new Error('Configured local accounts required');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  try {
    await page.getByLabel('Password', { exact: true }).fill(password);
  } catch {
    throw new Error('Unable to enter configured password');
  }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Signed in as ${email}`);
}
async function upload(page: Page) {
  const title = `B05 browser owned ${randomUUID()}`;
  await page.goto('/studio/upload');
  await page.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
    name: 'owned.gif',
    mimeType: 'image/gif',
    buffer: animatedGif(),
  });
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Upload privately', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'View durable private receipt' })
    .click();
  await expect(page.getByText('SUCCEEDED', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  return { id: new URL(page.url()).pathname.split('/').at(-1)!, title };
}
test('reviewer inspects private poster/GIF, approves then removes with retained audit; uploader/anonymous are denied', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const page = await uploaderContext.newPage();
  const asset = await upload(page);
  console.log('B05 browser: real upload processed');
  expect((await page.goto('/review'))?.status()).toBe(403);
  for (const path of [
    '/api/v1/review/queue',
    `/api/v1/review/assets/${asset.id}`,
    `/api/v1/review/assets/${asset.id}/media/DISPLAY_GIF`,
    `/api/v1/review/assets/${asset.id}/media/POSTER_PNG`,
  ])
    expect((await page.request.get(path)).status()).toBe(403);
  const anonymous = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  const reviewer = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  try {
    for (const path of [
      '/review',
      '/api/v1/review/queue',
      `/api/v1/review/assets/${asset.id}/media/DISPLAY_GIF`,
      `/api/v1/review/assets/${asset.id}/media/POSTER_PNG`,
    ])
      expect((await anonymous.request.get(path)).status()).toBe(401);
    console.log(
      'B05 browser: anonymous and uploader review/preview denials verified',
    );
    const reviewPage = await reviewer.newPage();
    await login(reviewPage, 'REVIEWER');
    await reviewPage.goto('/review');
    await reviewPage
      .getByRole('button', { name: asset.title, exact: true })
      .click();
    await expect(
      reviewPage.getByRole('heading', { name: asset.title }),
    ).toBeVisible();
    console.log('B05 browser: reviewer detail opened');
    const image = reviewPage.getByRole('img');
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await reviewPage
      .getByRole('button', { name: 'Play private GIF', exact: true })
      .click();
    await expect(image).toHaveAttribute(
      'src',
      `/api/v1/review/assets/${asset.id}/media/DISPLAY_GIF`,
    );
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const media = await reviewPage.request.get(
      `/api/v1/review/assets/${asset.id}/media/DISPLAY_GIF`,
    );
    expect(media.status()).toBe(200);
    expect(media.headers()['cache-control']).toBe('no-store');
    console.log('B05 browser: poster and GIF decoded privately');
    expect(
      (
        await reviewPage.request.get(
          `/api/v1/review/assets/${asset.id}/media/ORIGINAL`,
        )
      ).status(),
    ).toBe(404);
    await reviewPage
      .getByLabel('Optional notes')
      .fill('Original owned animation checked');
    await reviewPage
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: APPROVED.', { exact: true }),
    ).toBeVisible();
    await expect(
      reviewPage.getByRole('button', {
        name: 'Remove / takedown',
        exact: true,
      }),
    ).toBeVisible();
    console.log('B05 browser: approval persisted and takedown available');
    await reviewPage.reload();
    await reviewPage.getByLabel('Asset ID', { exact: true }).fill(asset.id);
    await reviewPage
      .getByRole('button', { name: 'Open asset', exact: true })
      .click();
    await expect(
      reviewPage.getByText('APPROVED', { exact: true }),
    ).toBeVisible();
    await reviewPage
      .getByLabel('Reason', { exact: true })
      .selectOption('RIGHTS_REQUEST');
    await reviewPage
      .getByRole('button', { name: 'Remove / takedown', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: REMOVED.', { exact: true }),
    ).toBeVisible();
    await expect(
      reviewPage.getByText('REMOVED', { exact: true }),
    ).toBeVisible();
    await expect(reviewPage.getByText(/MODERATION_APPROVE/)).toBeVisible();
    await expect(reviewPage.getByText(/MODERATION_REMOVE/)).toBeVisible();
    console.log('B05 browser: removal persisted with approval/removal audit');
    const d = await (
      await reviewPage.request.get(`/api/v1/review/assets/${asset.id}`)
    ).json();
    expect(d.decisions.map((x: { action: string }) => x.action)).toEqual([
      'APPROVE',
      'REMOVE',
    ]);
    expect(d.states).toMatchObject({
      searchEligibility: 'INELIGIBLE',
      indexing: 'NOT_INDEXED',
      apiAvailability: 'BLOCKED',
    });
    for (const path of [
      '/api/v1/public/gifs',
      `/media/${asset.id}/display.gif`,
    ])
      expect((await anonymous.request.get(path)).status()).toBe(404);
    await reviewPage.screenshot({
      path: 'test-results/b05-removed-audit.png',
      timeout: 10000,
    });
    console.log('B05 browser: flow and screenshot complete');
  } finally {
    console.log('B05 browser: closing review contexts');
    await Promise.all([reviewer.close(), anonymous.close()]);
  }
});
test('reviewer rejects with reason; simultaneous stale UI conflicts and requires reload; loading/errors are truthful', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const page = await uploaderContext.newPage();
  let asset = await upload(page);
  const context = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  try {
    const reviewer = await context.newPage();
    await login(reviewer, 'REVIEWER');
    await reviewer.goto('/review');
    await reviewer.getByLabel('Asset ID', { exact: true }).fill(asset.id);
    await reviewer
      .getByRole('button', { name: 'Open asset', exact: true })
      .click();
    await expect(
      reviewer.getByRole('button', { name: 'Reject', exact: true }),
    ).toBeVisible();
    await reviewer.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(reviewer.getByRole('alert')).toHaveText(
      'Choose a reason before rejecting or removing.',
    );
    await reviewer
      .getByLabel('Reason', { exact: true })
      .selectOption('RIGHTS_CONCERN');
    await reviewer
      .getByLabel('Optional notes')
      .fill('Browser UI rights review');
    await reviewer.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(
      reviewer.getByText('Decision saved: REJECTED.', { exact: true }),
    ).toBeVisible();
    await expect(reviewer.getByText('REJECTED', { exact: true })).toBeVisible();
    // A separate processed asset exercises the stale version recovery path.
    asset = await upload(page);
    await reviewer.getByLabel('Asset ID', { exact: true }).fill(asset.id);
    await reviewer
      .getByRole('button', { name: 'Open asset', exact: true })
      .click();
    await expect(
      reviewer.getByRole('button', { name: 'Approve', exact: true }),
    ).toBeVisible();
    // Another real HTTP decision wins while this browser retains version 1.
    const session = await (
      await reviewer.request.get('/api/v1/auth/session')
    ).json();
    const decision = await reviewer.request.post(
      `/api/v1/review/assets/${asset.id}/decision`,
      {
        headers: {
          origin: 'http://localhost:8080',
          'X-CSRF-Token': session.csrfToken,
        },
        data: {
          decision: 'REJECT',
          reasonCode: 'RIGHTS_CONCERN',
          reasonNote: 'Browser case review',
          expectedVersion: 1,
        },
      },
    );
    expect(decision.status()).toBe(200);
    await reviewer
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(reviewer.getByRole('alert')).toContainText('Conflict:');
    await expect(
      reviewer.getByRole('button', { name: 'Approve', exact: true }),
    ).toBeDisabled();
    await reviewer
      .getByRole('button', { name: 'Reload asset', exact: true })
      .click();
    await expect(reviewer.getByText('REJECTED', { exact: true })).toBeVisible();
    await expect(reviewer.getByText(/Browser case review/)).toBeVisible();
    await expect(
      reviewer.getByRole('button', { name: 'Approve', exact: true }),
    ).toHaveCount(0);
    await reviewer.screenshot({ path: 'test-results/b05-rejected.png' });
    const repeat = await reviewer.request.post(
      `/api/v1/review/assets/${asset.id}/decision`,
      {
        headers: {
          origin: 'http://localhost:8080',
          'X-CSRF-Token': session.csrfToken,
        },
        data: {
          decision: 'REJECT',
          reasonCode: 'RIGHTS_CONCERN',
          reasonNote: 'Browser case review',
          expectedVersion: 1,
        },
      },
    );
    expect(repeat.status()).toBe(200);
    await reviewer.route('**/api/v1/review/queue*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await reviewer
      .getByRole('button', { name: 'Refresh queue', exact: true })
      .click();
    await expect(reviewer.getByRole('alert')).toHaveText(
      'Review service unavailable. Please retry.',
    );
    await reviewer.unroute('**/api/v1/review/queue*');
    await reviewer
      .getByRole('button', { name: 'Refresh queue', exact: true })
      .click();
    await expect(reviewer.getByRole('alert')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
