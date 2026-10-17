import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { animatedGif } from '@gif/testing';
test.use({ trace: 'off', video: 'off' });
async function login(page: Page, role: 'UPLOADER' | 'REVIEWER') {
  const email = process.env[`DEV_${role}_EMAIL`],
    password = process.env[`DEV_${role}_PASSWORD`];
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
test('approved public gallery and detail, keyboard and reduced motion, safe media, metadata and immediate takedown', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const owner = await browser.newContext({ baseURL: 'http://localhost:8080' });
  const reviewer = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  const anonymous = await browser.newContext({
    baseURL: 'http://localhost:8080',
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  try {
    const upload = await owner.newPage();
    await login(upload, 'UPLOADER');
    const query = `B06 Firefly ${randomUUID()}`;
    const title = `${query} ${'z'.repeat(105)}`,
      tag = `firefly-${randomUUID()}`;
    await upload.goto('/studio/upload');
    await upload.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
      name: 'owned.gif',
      mimeType: 'image/gif',
      buffer: animatedGif(),
    });
    await upload.getByLabel('Title', { exact: true }).fill(title);
    await upload.getByLabel('Tags (comma separated, optional)').fill(tag);
    await upload.getByRole('checkbox').check();
    await upload
      .getByRole('button', { name: 'Upload privately', exact: true })
      .click();
    await upload
      .getByRole('link', { name: 'View durable private receipt' })
      .click();
    await expect(upload.getByText('SUCCEEDED', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const id = new URL(upload.url()).pathname.split('/').at(-1)!;
    const publicPage = await anonymous.newPage();
    const failures: string[] = [];
    publicPage.on('pageerror', (e) => failures.push(e.message));
    for (const path of [
      `/api/v1/public/gifs/${id}`,
      `/media/${id}/display.gif`,
      `/media/${id}/poster.png`,
    ])
      expect((await publicPage.request.get(path)).status()).toBe(404);
    await publicPage.goto(`/?q=${encodeURIComponent(query)}`);
    await expect(
      publicPage.getByText('No GIFs found. Try another title or tag.'),
    ).toBeVisible();
    const reviewPage = await reviewer.newPage();
    await login(reviewPage, 'REVIEWER');
    await reviewPage.goto('/review');
    await reviewPage.getByRole('button', { name: title, exact: true }).click();
    await reviewPage
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: APPROVED.', { exact: true }),
    ).toBeVisible();
    await publicPage.goto('/');
    await publicPage.getByLabel('Search GIFs', { exact: true }).fill(query);
    await publicPage.getByLabel('Search GIFs', { exact: true }).press('Enter');
    const link = publicPage.getByRole('link', { name: title, exact: true });
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await publicPage.keyboard.press('Enter');
    await expect(
      publicPage.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    const image = publicPage.getByRole('img');
    await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
    await expect(image).toHaveAttribute('alt', title);
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(
      publicPage.getByText('Reduced motion is enabled.', { exact: false }),
    ).toBeVisible();
    const play = publicPage.getByRole('button', {
      name: 'Play GIF',
      exact: true,
    });
    await play.focus();
    await publicPage.keyboard.press('Enter');
    await expect(image).toHaveAttribute('src', `/media/${id}/display.gif`);
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await publicPage.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
    await publicPage
      .getByRole('button', { name: 'Play GIF', exact: true })
      .click();
    await publicPage.emulateMedia({ reducedMotion: 'reduce' });
    await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
    await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `http://localhost:8080/g/${id}`,
    );
    await expect(
      publicPage.locator('meta[property="og:image"]'),
    ).toHaveAttribute(
      'content',
      `http://localhost:8080/media/${id}/poster.png`,
    );
    await expect(
      publicPage.locator('meta[name="robots"]').first(),
    ).toHaveAttribute('content', /index, follow/);
    expect(await publicPage.content()).not.toMatch(
      /objectKey|objectVersionId|quarantine\/|@local\.test|X-Amz-Signature/,
    );
    expect(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await publicPage.screenshot({
      path: 'test-results/b06-public-detail-mobile.png',
      fullPage: true,
    });
    const response = await publicPage.request.get(`/media/${id}/display.gif`);
    expect(response.status()).toBe(200);
    const etag = response.headers().etag!;
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=30, must-revalidate',
    );
    await publicPage.goto(`/?tag=${encodeURIComponent(tag.toUpperCase())}`);
    await expect(
      publicPage.getByRole('link', { name: title, exact: true }),
    ).toBeVisible();
    await publicPage.screenshot({
      path: 'test-results/b06-public-gallery-mobile.png',
      fullPage: true,
    });
    // Use an uncached anonymous context: earlier verified posters can remain in
    // the browser's decoded-image cache and would not exercise a network failure.
    const failureContext = await browser.newContext({
      baseURL: 'http://localhost:8080',
      reducedMotion: 'reduce',
    });
    try {
      const failurePage = await failureContext.newPage();
      let aborted = 0;
      await failurePage.route(`**/media/${id}/poster.png`, (route) => {
        aborted++;
        return route.abort();
      });
      await failurePage.goto(`/g/${id}`);
      await expect.poll(() => aborted).toBeGreaterThan(0);
      await expect(
        failurePage.getByRole('button', { name: 'Retry media', exact: true }),
      ).toBeVisible();
      await failurePage.unroute(`**/media/${id}/poster.png`);
      await failurePage
        .getByRole('button', { name: 'Retry media', exact: true })
        .click();
      await expect
        .poll(() =>
          failurePage
            .getByRole('img')
            .evaluate(
              (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
            ),
        )
        .toBe(true);
    } finally {
      await failureContext.close();
    }
    await reviewPage
      .getByLabel('Reason', { exact: true })
      .selectOption('RIGHTS_REQUEST');
    await reviewPage
      .getByRole('button', { name: 'Remove / takedown', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: REMOVED.', { exact: true }),
    ).toBeVisible();
    for (const path of [
      `/api/v1/public/gifs/${id}`,
      `/media/${id}/display.gif`,
      `/media/${id}/poster.png`,
    ])
      expect(
        (
          await publicPage.request.get(path, {
            headers: { 'If-None-Match': etag },
          })
        ).status(),
      ).toBe(404);
    await publicPage.goto(`/g/${id}`);
    await expect(
      publicPage.getByRole('heading', { name: 'GIF unavailable', exact: true }),
    ).toBeVisible();
    expect(await publicPage.content()).not.toContain(title);
    await expect(
      publicPage.locator('meta[name="robots"]').first(),
    ).toHaveAttribute('content', /noindex/);
    await publicPage.goto(`/?q=${encodeURIComponent(query)}`);
    await expect(
      publicPage.getByText('No GIFs found. Try another title or tag.'),
    ).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await owner.close();
    await reviewer.close();
    await anonymous.close();
  }
});
test('public search loading, empty, error and keyboard retry states are accessible', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/public/gifs?*', async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PUBLIC_UNAVAILABLE',
          message: 'Unavailable',
          requestId: 'browser',
        },
      }),
    });
  });
  await page.goto('/?q=absent');
  await expect(page.getByText('Loading GIFs…', { exact: true })).toBeVisible();
  release!();
  await expect(
    page.getByRole('region', { name: 'Discover GIFs' }).getByRole('alert'),
  ).toContainText('GIFs could not be loaded.');
  await page.unroute('**/api/v1/public/gifs?*');
  const retry = page.getByRole('button', { name: 'Retry search', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('No GIFs found. Try another title or tag.'),
  ).toBeVisible();
  await page.goto('/?q=' + 'x'.repeat(101));
  await expect(
    page.getByRole('region', { name: 'Discover GIFs' }).getByRole('alert'),
  ).toContainText('Check your search');
});
