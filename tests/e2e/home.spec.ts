import { test, expect } from '@playwright/test';

test('home renders and reports real readiness through the edge', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'GIF Platform — local development' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Dependencies ready — PostgreSQL and object store reachable',
  );
  expect(failures).toEqual([]);
});

test('home reports dependency failure without treating HTTP 503 as ready', async ({
  page,
}) => {
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'not_ready',
        checks: { database: 'down', storage: 'up' },
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Dependencies unavailable');
});

test('home reports an unreachable API', async ({ page }) => {
  await page.route('**/api/v1/health/ready', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(
    'API unavailable or health response invalid',
  );
});
