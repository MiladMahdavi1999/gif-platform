import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'work/b09-staging-playwright.json' }],
  ],
  use: {
    baseURL: 'https://localhost:8443',
    // Disposable self-signed local CA only; deployed services still enforce TLS.
    ignoreHTTPSErrors: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
});
