import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { animatedGif } from '@gif/testing';
import {
  ownerAssetSchema,
  reviewDetailSchema,
  publicDetailSchema,
  publicGifsSchema,
  uploadIntentSchema,
} from '@gif/contracts';

// No request routing/mocking, seed API, direct SQL, worker substitute.
test('clean production staging: real private upload, FFmpeg, distinct review, public Picker and takedown', async ({
  browser,
}) => {
  const steps: string[] = [];
  const mark = (value: string) => {
    steps.push(value);
    console.log(`PASS: ${value}`);
  };
  const options = {
    baseURL: 'https://localhost:8443',
    ignoreHTTPSErrors: true,
  };
  const owner = await browser.newContext(options),
    moderator = await browser.newContext(options),
    anonymous = await browser.newContext(options);
  let assetId = '';
  const derivativeSha256: Record<string, string> = {};
  const ownerPage = await owner.newPage(),
    reviewPage = await moderator.newPage(),
    publicPage = await anonymous.newPage();
  const hostWrites: string[] = [];
  publicPage.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      hostWrites.push(new URL(request.url()).pathname);
  });
  const title = `B09 synthetic pixels ${randomUUID()}`;
  async function login(page: Page, role: 'UPLOADER' | 'REVIEWER') {
    const email = process.env[`BOOTSTRAP_${role}_EMAIL`],
      password = process.env[`BOOTSTRAP_${role}_PASSWORD`];
    if (!email || !password)
      throw new Error('Explicit staging bootstrap credentials required');
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    try {
      await page.getByLabel('Password', { exact: true }).fill(password);
    } catch {
      throw new Error('Unable to enter configured credential');
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Sign out', exact: true }),
    ).toBeVisible();
    const session = await (
      await page.request.get('/api/v1/auth/session')
    ).json();
    expect(session.authenticated).toBe(true);
    const cookies = await page.context().cookies();
    expect(
      cookies.some(
        (c) =>
          c.name === 'gif_session' &&
          c.httpOnly &&
          c.secure &&
          c.sameSite === 'Lax',
      ),
    ).toBe(true);
    return session;
  }
  async function denied(request: APIRequestContext) {
    for (const path of [
      `/api/v1/public/gifs/${assetId}`,
      `/media/${assetId}/display.gif`,
      `/media/${assetId}/poster.png`,
      `/media/${assetId}/ORIGINAL`,
    ])
      expect((await request.get(path)).status()).toBe(404);
    const response = await request.get('/api/v1/public/gifs', {
      params: { q: title },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).items).toHaveLength(0);
  }
  try {
    for (const path of ['/api/v1/health/live', '/api/v1/health/ready'])
      expect((await anonymous.request.get(path)).status()).toBe(200);
    const initial = await anonymous.request.get('/api/v1/public/gifs');
    expect((await initial.json()).items).toHaveLength(0);
    mark('empty public platform and actual liveness/readiness');
    const uploader = await login(ownerPage, 'UPLOADER');
    mark('authorized uploader authenticated with Secure HttpOnly session');
    // SL-AC-09: the same owner can recover from a typed private failure with a NEW intent.
    await ownerPage.goto('/studio/upload');
    await ownerPage
      .getByLabel('Animated GIF (up to 20 MiB)')
      .setInputFiles({
        name: 'b09-owned-static.gif',
        mimeType: 'image/gif',
        buffer: animatedGif({ frameCount: 1 }),
      });
    await ownerPage
      .getByLabel('Title', { exact: true })
      .fill('B09 synthetic static failure');
    await ownerPage.getByRole('checkbox').check();
    const invalidIntentPromise = ownerPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/uploads' &&
        r.request().method() === 'POST',
    );
    await ownerPage
      .getByRole('button', { name: 'Upload privately', exact: true })
      .click();
    const invalidIntent = await (await invalidIntentPromise).json();
    await ownerPage
      .getByRole('link', { name: 'View durable private receipt' })
      .click();
    await expect(
      ownerPage.getByText('FAILED_TERMINAL', { exact: true }),
    ).toBeVisible({ timeout: 45000 });
    const invalidReceipt = await (
      await ownerPage.request.get(`/api/v1/me/assets/${invalidIntent.assetId}`)
    ).json();
    expect(invalidReceipt.errorCode).toBe('MEDIA_NOT_ANIMATED');
    expect(invalidReceipt.states.visibility).toBe('PRIVATE');
    expect(
      (
        await anonymous.request.get(
          `${invalidIntent.form.url}/${invalidIntent.form.fields.key}`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await anonymous.request.get(
          `/media/${invalidIntent.assetId}/display.gif`,
        )
      ).status(),
    ).toBe(404);
    mark(
      'typed static-GIF failure stays private; same owner starts a new valid upload',
    );
    await ownerPage.goto('/studio/upload');
    await ownerPage.getByLabel('Animated GIF (up to 20 MiB)').setInputFiles({
      name: 'b09-owned-pixels.gif',
      mimeType: 'image/gif',
      buffer: animatedGif(),
    });
    await ownerPage.getByLabel('Title', { exact: true }).fill(title);
    await ownerPage
      .getByLabel('Tags (comma separated, optional)')
      .fill('b09, synthetic');
    await ownerPage.getByRole('checkbox').check();
    const intentPromise = ownerPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/uploads' &&
        r.request().method() === 'POST',
    );
    const directPromise = ownerPage.waitForResponse(
      (r) =>
        new URL(r.url()).origin === 'https://localhost:9443' &&
        r.request().method() === 'POST',
    );
    await ownerPage
      .getByRole('button', { name: 'Upload privately', exact: true })
      .click();
    const intent = await (await intentPromise).json();
    expect(uploadIntentSchema.safeParse(intent).success).toBe(true);
    assetId = intent.assetId;
    expect(assetId !== invalidIntent.assetId).toBe(true);
    expect((await directPromise).status()).toBe(204);
    await expect(ownerPage.getByRole('main').getByRole('status')).toContainText(
      'Received privately.',
    );
    await ownerPage
      .getByRole('link', { name: 'View durable private receipt' })
      .click();
    const receipt = await (
      await ownerPage.request.get(`/api/v1/me/assets/${assetId}`)
    ).json();
    expect(ownerAssetSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.states.visibility).toBe('PRIVATE');
    const rawUrl = `${intent.form.url}/${intent.form.fields.key}`;
    expect((await anonymous.request.get(rawUrl)).status()).toBe(403);
    await denied(anonymous.request);
    mark(
      'real browser signed TLS POST, private durable receipt, quarantine GET denied',
    );
    await expect(ownerPage.getByText('SUCCEEDED', { exact: true })).toBeVisible(
      { timeout: 45000 },
    );
    const processed = await (
      await ownerPage.request.get(`/api/v1/me/assets/${assetId}`)
    ).json();
    expect(processed.states).toMatchObject({
      processing: 'SUCCEEDED',
      visibility: 'PRIVATE',
      moderation: 'PENDING',
      deliveryReadiness: 'READY',
      indexing: 'NOT_INDEXED',
    });
    await denied(anonymous.request);
    const replay = await ownerPage.request.post(
      `/api/v1/uploads/${intent.uploadId}/complete`,
      {
        headers: {
          Origin: 'https://localhost:8443',
          'X-CSRF-Token': uploader.csrfToken,
        },
        data: {},
      },
    );
    expect(replay.status()).toBe(202);
    expect((await replay.json()).assetId === assetId).toBe(true);
    const forbidden = await ownerPage.request.post(
      `/api/v1/review/assets/${assetId}/decision`,
      {
        headers: {
          Origin: 'https://localhost:8443',
          'X-CSRF-Token': uploader.csrfToken,
        },
        data: {
          decision: 'APPROVE',
          reasonCode: 'POLICY_PASSED',
          expectedVersion: processed.rowVersion,
        },
      },
    );
    expect(forbidden.status()).toBe(403);
    mark(
      'real Worker processing, private derivatives, idempotent complete and uploader approval denial',
    );
    const reviewer = await login(reviewPage, 'REVIEWER');
    expect(reviewer.user.id !== uploader.user.id).toBe(true);
    await reviewPage.goto('/review');
    await reviewPage.getByRole('button', { name: title, exact: true }).click();
    await expect(
      reviewPage.getByRole('heading', { name: title }),
    ).toBeVisible();
    const before = await (
      await reviewPage.request.get(`/api/v1/review/assets/${assetId}`)
    ).json();
    expect(reviewDetailSchema.safeParse(before).success).toBe(true);
    expect(before.decisions).toHaveLength(0);
    for (const variant of ['DISPLAY_GIF', 'POSTER_PNG']) {
      const response = await reviewPage.request.get(
        `/api/v1/review/assets/${assetId}/media/${variant}`,
      );
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      const bytes = await response.body();
      expect(bytes.length > 0).toBe(true);
      derivativeSha256[variant] = createHash('sha256')
        .update(bytes)
        .digest('hex');
    }
    await reviewPage
      .getByRole('button', { name: 'Play private GIF', exact: true })
      .click();
    await expect
      .poll(() =>
        reviewPage
          .getByRole('img')
          .evaluate(
            (element: HTMLImageElement) =>
              element.complete && element.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await reviewPage
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: APPROVED.', { exact: true }),
    ).toBeVisible();
    const approved = await (
      await reviewPage.request.get(`/api/v1/review/assets/${assetId}`)
    ).json();
    expect(approved.decisions).toHaveLength(1);
    expect(approved.decisions[0].reviewerId === reviewer.user.id).toBe(true);
    expect(approved.states).toMatchObject({
      visibility: 'PUBLIC',
      moderation: 'APPROVED',
      searchEligibility: 'ELIGIBLE',
      indexing: 'INDEXED',
      apiAvailability: 'ENABLED',
    });
    expect(
      approved.audit.some(
        (e: { eventType: string }) => e.eventType === 'MODERATION_APPROVE',
      ),
    ).toBe(true);
    mark(
      'distinct human-role moderator decoded private derivatives and approved once with audit',
    );
    const list = await (
      await anonymous.request.get('/api/v1/public/gifs', {
        params: { q: title },
      })
    ).json();
    expect(publicGifsSchema.safeParse(list).success).toBe(true);
    expect(list.items.length === 1 && list.items[0].id === assetId).toBe(true);
    const detail = await (
      await anonymous.request.get(`/api/v1/public/gifs/${assetId}`)
    ).json();
    expect(publicDetailSchema.safeParse(detail).success).toBe(true);
    for (const value of [list, detail, processed, approved]) {
      const text = JSON.stringify(value);
      expect(
        /quarantine_key|objectKey|objectVersionId|received_version_id|X-Amz-|password_hash/i.test(
          text,
        ),
      ).toBe(false);
      for (const key of [
        'MINIO_ROOT_PASSWORD',
        'S3_API_SECRET_ACCESS_KEY',
        'S3_WORKER_SECRET_ACCESS_KEY',
        'ADMIN_DATABASE_URL',
      ])
        expect(
          text.includes(process.env[key] ?? 'missing-private-sentinel'),
        ).toBe(false);
    }
    expect((await publicPage.goto(`/g/${assetId}`))?.status()).toBe(200);
    await expect(
      publicPage.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    for (const variant of ['display.gif', 'poster.png'])
      expect(
        (await anonymous.request.get(`/media/${assetId}/${variant}`)).status(),
      ).toBe(200);
    expect((await anonymous.request.get(rawUrl)).status()).toBe(403);
    mark(
      'eligible public search, actual Web detail and sanitized aliases; no private identifiers in DTOs',
    );
    await publicPage.goto('/demo/host-picker');
    const open = publicPage.getByRole('button', {
      name: 'Open GIF Picker',
      exact: true,
    });
    await open.click();
    const dialog = publicPage.getByRole('dialog', { name: 'Choose a GIF' });
    await dialog.getByLabel('Search GIFs', { exact: true }).fill(title);
    await publicPage.keyboard.press('Enter');
    await dialog
      .getByRole('button', { name: `Select ${title}`, exact: true })
      .click();
    await expect(publicPage.getByRole('status')).toHaveText(
      'Selected; no host action performed.',
    );
    await expect(
      publicPage.locator('output[aria-label="Terminal callbacks received"]'),
    ).toHaveText('1');
    expect(hostWrites).toEqual([]);
    await publicPage.screenshot({
      path: 'work/b09-picker-selected.png',
      fullPage: true,
    });
    mark(
      'Host received selected only: Selected; no host action performed. No write request',
    );
    await open.click();
    await publicPage.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect(publicPage.getByRole('status')).toHaveText(
      'Cancelled; no host action performed.',
    );
    await open.click();
    await dialog
      .getByLabel('Search GIFs', { exact: true })
      .fill('noresult' + randomUUID().replaceAll('-', ''));
    await publicPage.keyboard.press('Enter');
    await expect(
      dialog.getByText('No GIFs found. Try another title or tag.', {
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.keyboard.press('Escape');
    mark(
      'real Picker Escape cancellation, restored focus and accessible empty search',
    );
    // Hold an actual result card open across removal; select must reauthorize.
    await open.click();
    await dialog.getByLabel('Search GIFs', { exact: true }).fill(title);
    await publicPage.keyboard.press('Enter');
    const select = dialog.getByRole('button', {
      name: `Select ${title}`,
      exact: true,
    });
    await expect(select).toBeVisible();
    await reviewPage
      .getByLabel('Reason', { exact: true })
      .selectOption('RIGHTS_REQUEST');
    await reviewPage
      .getByRole('button', { name: 'Remove / takedown', exact: true })
      .click();
    await expect(
      reviewPage.getByText('Decision saved: REMOVED.', { exact: true }),
    ).toBeVisible();
    await denied(anonymous.request);
    expect((await anonymous.request.get(`/g/${assetId}`)).status()).toBe(404);
    const callbacks = await publicPage
      .locator('output[aria-label="Terminal callbacks received"]')
      .textContent();
    await select.click();
    await expect(dialog.getByRole('alert')).toContainText('Nothing selected');
    await expect(
      publicPage.locator('output[aria-label="Terminal callbacks received"]'),
    ).toHaveText(callbacks!);
    expect(hostWrites).toEqual([]);
    const removed = await (
      await reviewPage.request.get(`/api/v1/review/assets/${assetId}`)
    ).json();
    expect(removed.decisions.map((d: { action: string }) => d.action)).toEqual([
      'APPROVE',
      'REMOVE',
    ]);
    expect(
      removed.audit.some(
        (e: { eventType: string }) => e.eventType === 'MODERATION_REMOVE',
      ),
    ).toBe(true);
    mark(
      'takedown denies fresh origin/detail/search and stale Picker selection; approval/removal audit retained',
    );
    writeFileSync(
      'work/b09-smoke-evidence.json',
      JSON.stringify(
        {
          status: 'passed',
          assetId,
          title,
          steps,
          derivativeSha256,
          decisions: removed.decisions.map(
            (d: { action: string; reviewerId: string }) => ({
              action: d.action,
              reviewerId: d.reviewerId,
            }),
          ),
          audit: removed.audit.map(
            (e: { eventType: string; actorUserId: string | null }) => ({
              eventType: e.eventType,
              actorUserId: e.actorUserId,
            }),
          ),
          hostWriteRequests: hostWrites.length,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await Promise.all([owner.close(), moderator.close(), anonymous.close()]);
  }
});
