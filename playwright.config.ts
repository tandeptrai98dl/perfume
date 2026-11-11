import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the production build (`pnpm build` first). Locally and in CI the web server is
 * the standalone output; set E2E_BASE_URL to test an already running server instead.
 * Uses the installed Chrome when PLAYWRIGHT_CHANNEL=chrome (no browser download needed).
 */
const port = Number(process.env.E2E_PORT ?? 3200);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  projects: [
    // Storefront specs run first on both viewports; admin specs (≥1024 px UI) create catalogue
    // data, so they run afterwards and clean up, keeping storefront counts on the seed exact.
    {
      name: 'desktop',
      testIgnore: /admin-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testIgnore: /admin-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'admin',
      testMatch: /admin-.*\.spec\.ts/,
      dependencies: ['desktop', 'mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/start-standalone.mjs',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { PORT: String(port), NODE_ENV: 'production', APP_URL: baseURL },
      },
});
