import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import {
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  serializeCookieConsent,
} from './src/lib/privacy/cookie-consent';

/**
 * E2E against the production build (`pnpm build` first). Locally and in CI the web server is
 * the standalone output; set E2E_BASE_URL to test an already running server instead.
 * Uses the installed Chrome when PLAYWRIGHT_CHANNEL=chrome (no browser download needed).
 */
const port = Number(process.env.E2E_PORT ?? 3200);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const channel = process.env.PLAYWRIGHT_CHANNEL;

/**
 * Every spec starts with the cookie notice answered ("reject all"), so the fixed banner never
 * covers controls; `privacy.spec.ts` opts out with an empty storage state to test the banner.
 */
const answeredCookieNotice = {
  cookies: [
    {
      name: COOKIE_CONSENT_NAME,
      value: encodeURIComponent(
        serializeCookieConsent({
          version: COOKIE_CONSENT_VERSION,
          analytics: false,
          ads: false,
          decidedAt: 1_762_905_600,
          receiptId: null,
        }),
      ),
      domain: new URL(baseURL).hostname,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Animations off (globals.css honours prefers-reduced-motion): no mid-transition
    // screenshots or axe colour-contrast readings on fading toasts and sheets.
    contextOptions: { reducedMotion: 'reduce' },
    storageState: answeredCookieNotice,
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
        env: {
          PORT: String(port),
          NODE_ENV: 'production',
          APP_URL: baseURL,
          // Payment gateways run as the signed sandbox simulator (no network, localhost only).
          PAYMENT_SIMULATOR: process.env.PAYMENT_SIMULATOR ?? 'true',
          // Every test account signs in from one IP; the limits themselves are unit-tested.
          AUTH_RATE_LIMIT: 'off',
          // Specs give each shopper its own IP via x-forwarded-for (place-order limit 5/min/IP).
          // Only acceptable because nothing but the test runner can reach this server.
          TRUSTED_IP_HEADER: 'x-forwarded-for',
          // Return photos (private storage) on the local filesystem; absolute because the
          // standalone server runs from .next/standalone.
          MEDIA_STORAGE: process.env.MEDIA_STORAGE ?? 'local',
          MEDIA_LOCAL_DIR: process.env.MEDIA_LOCAL_DIR ?? resolve('.data/e2e-media'),
        },
      },
});
