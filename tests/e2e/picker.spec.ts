import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { animatedGif } from '@gif/testing';

test.use({ trace: 'off', video: 'off' });
const id = '16f72691-8f32-426f-8f86-e42b6b520879';
const gif = (index = 0) => ({
  id: index ? `16f72691-8f32-426f-8f86-e42b6b52087${index}` : id,
  title: `Owned GIF ${index}`,
  tags: [],
  creator: { id, displayName: 'Creator' },
  posterUrl: `/media/${index ? `16f72691-8f32-426f-8f86-e42b6b52087${index}` : id}/poster.png`,
  displayUrl: `/media/${index ? `16f72691-8f32-426f-8f86-e42b6b52087${index}` : id}/display.gif`,
  createdAt: '2026-10-17T00:00:00Z',
});
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Choose a GIF' });
const terminalCount = (page: Page) =>
  page.locator('output[aria-label="Terminal callbacks received"]');
async function open(page: Page) {
  await page.goto('/demo/host-picker');
  await page
    .getByRole('button', { name: 'Open GIF Picker', exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByLabel('Search GIFs', { exact: true }),
  ).toBeFocused();
}
async function controlled(page: Page) {
  await page.route('**/api/v1/public/gifs?*', (route) =>
    route.fulfill({ json: { items: [gif(), gif(1), gif(2)] } }),
  );
  await page.route('**/api/v1/public/gifs/*', (route) =>
    route.fulfill({
      json: { ...gif(), description: null, attribution: 'Creator' },
    }),
  );
  await page.route('**/media/**', (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith('.png')
        ? 'image/png'
        : 'image/gif',
      body: route.request().url().endsWith('.png')
        ? Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aarsAAAAASUVORK5CYII=',
            'base64',
          )
        : animatedGif(),
    }),
  );
}
async function auth(request: APIRequestContext, role: 'UPLOADER' | 'REVIEWER') {
  const email = process.env[`DEV_${role}_EMAIL`],
    password = process.env[`DEV_${role}_PASSWORD`];
  if (!email || !password)
    throw new Error('Configured local accounts required');
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:8080' },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return {
    Origin: 'http://localhost:8080',
    'X-CSRF-Token': (await response.json()).csrfToken as string,
  };
}

test('real owned upload/processing/approval to Picker; one selected callback, fresh removal denial, and no Host action', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const owner = await browser.newContext({ baseURL: 'http://localhost:8080' });
  const reviewer = await browser.newContext({
    baseURL: 'http://localhost:8080',
  });
  const host = await browser.newContext({ baseURL: 'http://localhost:8080' });
  try {
    const ownerHeaders = await auth(owner.request, 'UPLOADER');
    const reviewHeaders = await auth(reviewer.request, 'REVIEWER');
    const title = `B07 own pixels ${randomUUID()}`;
    const intent = await owner.request.post('/api/v1/uploads', {
      headers: { ...ownerHeaders, 'Idempotency-Key': randomUUID() },
      data: {
        kind: 'GIF',
        title,
        tags: ['b07'],
        rightsAttested: true,
        rightsAttestationVersion: 'v1',
        claimedSizeBytes: animatedGif().length,
      },
    });
    expect(intent.status()).toBe(201);
    const value = await intent.json();
    const upload = await owner.request.post(value.form.url, {
      multipart: {
        ...value.form.fields,
        file: {
          name: 'owned.gif',
          mimeType: 'image/gif',
          buffer: animatedGif(),
        },
      },
    });
    expect(upload.status()).toBe(204);
    expect(
      (
        await owner.request.post(`/api/v1/uploads/${value.uploadId}/complete`, {
          headers: ownerHeaders,
          data: {},
        })
      ).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.request.get(`/api/v1/me/assets/${value.assetId}`)
            ).json()
          ).states.processing,
        { timeout: 30000 },
      )
      .toBe('SUCCEEDED');
    const detail = await (
      await reviewer.request.get(`/api/v1/review/assets/${value.assetId}`)
    ).json();
    const approval = await reviewer.request.post(
      `/api/v1/review/assets/${value.assetId}/decision`,
      {
        headers: reviewHeaders,
        data: {
          decision: 'APPROVE',
          reasonCode: 'POLICY_PASSED',
          expectedVersion: detail.rowVersion,
        },
      },
    );
    expect(approval.status()).toBe(200);
    const page = await host.newPage();
    const writes: string[] = [],
      errors: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        writes.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page);
    await dialog(page).getByLabel('Search GIFs', { exact: true }).fill(title);
    await page.keyboard.press('Enter');
    const choice = dialog(page).getByRole('button', {
      name: `Select ${title}`,
      exact: true,
    });
    await expect(choice).toBeVisible();
    await expect
      .poll(() =>
        dialog(page)
          .getByRole('img', { name: title, exact: true })
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    let release!: () => void,
      reads = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      `**/api/v1/public/gifs/${value.assetId}`,
      async (route) => {
        reads++;
        await gate;
        await route.continue();
      },
    );
    await choice.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
      button.click();
    });
    await expect(
      dialog(page).getByText('Checking GIF eligibility…', { exact: true }),
    ).toBeVisible();
    await expect(terminalCount(page)).toHaveText('0');
    release();
    await expect(dialog(page)).not.toBeVisible();
    await expect(
      page.getByText('Selected; no host action performed.', { exact: true }),
    ).toBeVisible();
    await expect(terminalCount(page)).toHaveText('1');
    await expect(
      page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Selected GIF reference' }),
    ).toContainText(value.assetId);
    expect(reads).toBe(1);
    await page.screenshot({
      path: 'test-results/b07-host-selected.png',
      fullPage: true,
    });
    await page.unroute(`**/api/v1/public/gifs/${value.assetId}`);
    await page
      .getByRole('button', { name: 'Open GIF Picker', exact: true })
      .click();
    await dialog(page).getByLabel('Search GIFs', { exact: true }).fill(title);
    await page.keyboard.press('Enter');
    await expect(choice).toBeVisible();
    const removal = await reviewer.request.post(
      `/api/v1/review/assets/${value.assetId}/remove`,
      {
        headers: reviewHeaders,
        data: {
          reasonCode: 'RIGHTS_REQUEST',
          expectedVersion: (await approval.json()).rowVersion,
        },
      },
    );
    expect(removal.status()).toBe(200);
    await choice.click();
    await expect(dialog(page).getByRole('alert')).toContainText(
      'unavailable or restricted',
    );
    await expect(terminalCount(page)).toHaveText('1');
    expect(
      (await page.request.get(`/api/v1/public/gifs/${value.assetId}`)).status(),
    ).toBe(404);
    expect(
      (await page.request.get(`/media/${value.assetId}/display.gif`)).status(),
    ).toBe(404);
    await page.keyboard.press('Escape');
    await expect(terminalCount(page)).toHaveText('2');
    expect(writes).toEqual([]);
    expect(await page.locator('body').innerText()).not.toMatch(
      /\bsent\b|\bposted\b/i,
    );
    expect(await page.content()).not.toMatch(
      /objectKey|objectVersionId|quarantine\/|X-Amz-Signature/,
    );
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
    await reviewer.close();
    await host.close();
  }
});

test('keyboard-only search, navigation, selection, focus trap and restoration', async ({
  page,
}) => {
  await controlled(page);
  await page.goto('/demo/host-picker');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  const input = dialog(page).getByLabel('Search GIFs', { exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.type('owned');
  await page.keyboard.press('Enter');
  await expect(
    dialog(page).getByRole('button', {
      name: 'Select Owned GIF 0',
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog(page).getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Tab'); // Search
  await page.keyboard.press('Tab'); // Play
  await page.keyboard.press('Tab'); // Select first
  await expect(
    dialog(page).getByRole('button', {
      name: 'Select Owned GIF 0',
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    dialog(page).getByRole('button', {
      name: 'Select Owned GIF 1',
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(dialog(page)).not.toBeVisible();
  await expect(terminalCount(page)).toHaveText('1');
  await expect(
    page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
  ).toBeFocused();
});

test('Cancel and Escape each produce one cancelled result across clean reopenings', async ({
  page,
}) => {
  await controlled(page);
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Cancel', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(terminalCount(page)).toHaveText('1');
  await expect(
    page.getByText('Cancelled; no host action performed.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    dialog(page).getByLabel('Search GIFs', { exact: true }),
  ).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(terminalCount(page)).toHaveText('2');
  await expect(
    page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
  ).toBeFocused();
});

test('loading, recoverable search error, retry, empty and restricted states', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let mode = 503;
  await page.route('**/api/v1/public/gifs?*', async (route) => {
    await gate;
    await route.fulfill({
      status: mode,
      json: mode === 200 ? { items: [] } : {},
    });
  });
  await open(page);
  await expect(
    dialog(page).getByText('Loading GIFs…', { exact: true }),
  ).toBeVisible();
  release();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'could not be loaded',
  );
  mode = 200;
  await dialog(page)
    .getByRole('button', { name: 'Retry search', exact: true })
    .press('Enter');
  await expect(
    dialog(page).getByText('No GIFs found. Try another title or tag.', {
      exact: true,
    }),
  ).toBeVisible();
  mode = 403;
  await dialog(page)
    .getByLabel('Search GIFs', { exact: true })
    .fill('restricted');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('alert')).toContainText(
    'restricted or unavailable',
  );
  await expect(terminalCount(page)).toHaveText('0');
});

test('network selection failure retries fresh detail and returns the authoritative reference', async ({
  page,
}) => {
  await controlled(page);
  let reads = 0;
  await page.route(`**/api/v1/public/gifs/${id}`, (route) =>
    ++reads === 1
      ? route.abort()
      : route.fulfill({
          json: {
            ...gif(),
            title: 'Fresh title from detail',
            description: null,
            attribution: 'Creator',
          },
        }),
  );
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Select Owned GIF 0', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Nothing selected',
  );
  await expect(terminalCount(page)).toHaveText('0');
  await dialog(page)
    .getByRole('button', { name: 'Retry selection', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Selected GIF reference' }),
  ).toContainText('Fresh title from detail');
  await expect(terminalCount(page)).toHaveText('1');
  expect(reads).toBe(2);
});

test('Escape during pending selection aborts it and ignores its late response', async ({
  page,
}) => {
  await controlled(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/public/gifs/${id}`, async (route) => {
    await gate;
    await route.fulfill({
      json: { ...gif(), description: null, attribution: 'Creator' },
    });
  });
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Select Owned GIF 0', exact: true })
    .click();
  await expect(
    dialog(page).getByText('Checking GIF eligibility…', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  release();
  await expect(
    page.getByText('Cancelled; no host action performed.', { exact: true }),
  ).toBeVisible();
  await expect(terminalCount(page)).toHaveText('1');
  await expect(
    page.getByRole('button', { name: 'Open GIF Picker', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    dialog(page).getByRole('button', {
      name: 'Select Owned GIF 0',
      exact: true,
    }),
  ).toBeVisible();
  await expect(terminalCount(page)).toHaveText('1');
});

test('mobile and desktop layouts, explicit playback and reduced-motion preference changes', async ({
  page,
}) => {
  await controlled(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  const card = dialog(page)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name: 'Owned GIF 0', exact: true }),
    });
  const image = card.getByRole('img');
  await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
  await expect
    .poll(() =>
      image.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
    )
    .toBe(true);
  await expect(
    card.getByText('Reduced motion is enabled.', { exact: false }),
  ).toBeVisible();
  await card
    .getByRole('button', { name: 'Play GIF', exact: true })
    .press('Enter');
  await expect(image).toHaveAttribute('src', `/media/${id}/display.gif`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
  await card.getByRole('button', { name: 'Play GIF', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(image).toHaveAttribute('src', `/media/${id}/poster.png`);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await dialog(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.screenshot({
    path: 'test-results/b07-picker-mobile.png',
    fullPage: true,
  });
});

test('malformed unsafe detail cannot select, and new searches discard stale results', async ({
  page,
}) => {
  await controlled(page);
  await page.route(`**/api/v1/public/gifs/${id}`, (route) =>
    route.fulfill({
      json: {
        ...gif(),
        displayUrl: 'https://storage.invalid/original.gif',
        description: null,
        attribution: 'Creator',
      },
    }),
  );
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Select Owned GIF 0', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Nothing selected',
  );
  await expect(terminalCount(page)).toHaveText('0');
  await page.route('**/api/v1/public/gifs?*', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await dialog(page).getByLabel('Search GIFs', { exact: true }).fill('empty');
  await page.keyboard.press('Enter');
  await expect(
    dialog(page).getByRole('button', {
      name: 'Select Owned GIF 0',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog(page).getByText('No GIFs found. Try another title or tag.', {
      exact: true,
    }),
  ).toBeVisible();
});
