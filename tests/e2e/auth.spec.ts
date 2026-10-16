import { test, expect, type Page } from '@playwright/test';

// Authentication traffic includes secrets. Never retain request traces or videos.
test.use({ trace: 'off', video: 'off' });
const uploader = {
  email: process.env.DEV_UPLOADER_EMAIL!,
  password: process.env.DEV_UPLOADER_PASSWORD!,
};
const reviewer = {
  email: process.env.DEV_REVIEWER_EMAIL!,
  password: process.env.DEV_REVIEWER_PASSWORD!,
};
async function signIn(page: Page, account: typeof uploader) {
  if (!account.email || !account.password)
    throw new Error(
      'B01 seed credentials must be supplied through the environment',
    );
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Signed in as ${account.email}`,
  );
}

test('anonymous home is public and both review surfaces return 401', async ({
  page,
}) => {
  const home = await page.goto('/');
  expect(home?.status()).toBe(200);
  expect((await page.goto('/review'))?.status()).toBe(401);
  await expect(page.getByText('Sign in required')).toBeVisible();
  expect((await page.request.get('/api/v1/review')).status()).toBe(401);
});

test('two browser contexts preserve uploader/reviewer separation, refresh and server logout', async ({
  browser,
}) => {
  const first = await browser.newContext({ baseURL: 'http://localhost:8080' });
  const second = await browser.newContext({ baseURL: 'http://localhost:8080' });
  try {
    const uploaderPage = await first.newPage();
    const reviewerPage = await second.newPage();
    await signIn(uploaderPage, uploader);
    await signIn(reviewerPage, reviewer);
    await uploaderPage.reload();
    await expect(uploaderPage.getByRole('status')).toHaveText(
      `Signed in as ${uploader.email}`,
    );
    await reviewerPage.reload();
    await expect(reviewerPage.getByRole('status')).toHaveText(
      `Signed in as ${reviewer.email}`,
    );
    expect((await uploaderPage.goto('/review'))?.status()).toBe(403);
    await expect(uploaderPage.getByText('Access denied')).toBeVisible();
    expect((await reviewerPage.goto('/review'))?.status()).toBe(200);
    await expect(
      reviewerPage.getByText('Reviewer access verified.', { exact: false }),
    ).toBeVisible();
    await reviewerPage.screenshot({
      path: 'test-results/b02-review-access.png',
    });
    const cookie = (await second.cookies()).find(
      (c) => c.name === 'gif_session',
    );
    expect(Boolean(cookie?.httpOnly)).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/');
    expect(Boolean(cookie?.secure)).toBe(false); // Proven local HTTP development exception.
    expect((cookie?.expires ?? 0) > Date.now() / 1000).toBe(true);
    // HttpOnly session and CSRF values are never copied into browser storage.
    expect(
      await reviewerPage.evaluate(() =>
        document.cookie.includes('gif_session'),
      ),
    ).toBe(false);
    expect(
      await reviewerPage.evaluate(
        () => localStorage.length + sessionStorage.length,
      ),
    ).toBe(0);
    await reviewerPage.goto('/login');
    const oldCookie = cookie ? `${cookie.name}=${cookie.value}` : '';
    await reviewerPage
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();
    await expect(
      reviewerPage.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await reviewerPage.reload();
    await expect(
      reviewerPage.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    expect((await reviewerPage.goto('/review'))?.status()).toBe(401);
    const revoked = await reviewerPage.request.get('/api/v1/auth/session', {
      headers: { cookie: oldCookie },
    });
    expect((await revoked.json()).authenticated).toBe(false);
    expect((await uploaderPage.goto('/review'))?.status()).toBe(403);
    await uploaderPage.goto('/login');
    await uploaderPage
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();
    await expect(
      uploaderPage.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test('login validates input, shows uniform credential errors and handles transport failures', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect(
    await page
      .getByLabel('Email', { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
  ).toBe(true);
  for (const email of [uploader.email, 'unknown@local.test']) {
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('incorrect');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Invalid email or password.',
    );
  }
  await page.route('**/api/v1/auth/login', (route) => route.abort());
  await page.getByLabel('Email', { exact: true }).fill(uploader.email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Unable to reach the server. Please try again.',
  );
});

test('browser rejects missing CSRF; server rejects hostile Origin and form login', async ({
  page,
}) => {
  await signIn(page, uploader);
  const csrfStatus = await page.evaluate(
    async () => (await fetch('/api/v1/auth/logout', { method: 'POST' })).status,
  );
  expect(csrfStatus).toBe(403);
  expect(
    (
      await page.request.post('/api/v1/auth/logout', {
        headers: { origin: 'https://evil.test' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/v1/auth/login', {
        headers: { origin: 'http://localhost:8080' },
        form: { email: uploader.email, password: 'incorrect' },
      })
    ).status(),
  ).toBe(415);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});

test('login retry limit is visible and cannot be bypassed with forwarded IP headers', async ({
  page,
}) => {
  // Unknown account keeps the B01 personas usable for other tests.
  let status = 0;
  for (let index = 0; index < 11; index++) {
    const response = await page.request.post('/api/v1/auth/login', {
      headers: {
        origin: 'http://localhost:8080',
        'x-forwarded-for': `198.51.100.${index}`,
      },
      data: { email: 'rate-limit-browser@local.test', password: 'incorrect' },
    });
    status = response.status();
    if (status === 429) {
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
      break;
    }
  }
  expect(status).toBe(429);
  await page.goto('/login');
  await page
    .getByLabel('Email', { exact: true })
    .fill('rate-limit-browser@local.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Too many login attempts. Please try again later.',
  );
});
