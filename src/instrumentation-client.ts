import type * as SentryModule from '@sentry/nextjs';
import { config as zodConfig } from 'zod/v4/core';

import { publicEnv } from '@/lib/public-env';

// Zod v4 probes `new Function` to compile object parsers, which the CSP forbids (no
// 'unsafe-eval', ADR-0024). Set before any client form parses (this file runs first).
// Only Zod's tiny config module is imported here, not the validators.
zodConfig({ jitless: true });

/**
 * Browser error reporting; only when NEXT_PUBLIC_SENTRY_DSN is set at build time. The SDK
 * (~60 KB gzip) is loaded after the page has loaded and gone idle, so it never counts against
 * the first-load JavaScript budget or delays LCP/INP (ARCHITECTURE.md §14.1). Trade-off:
 * errors thrown before it initialises (the first second or so) are not reported.
 */
let sentry: typeof SentryModule | undefined;

const dsn = publicEnv.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  const load = () => {
    void Promise.all([import('@sentry/nextjs'), import('@/lib/observability/sentry-options')]).then(
      ([Sentry, { sentryOptions }]) => {
        Sentry.init(
          sentryOptions({ dsn, environment: process.env.NODE_ENV, tracesSampleRate: 0.05 }),
        );
        sentry = Sentry;
      },
    );
  };
  const whenIdle = () =>
    'requestIdleCallback' in window ? requestIdleCallback(load, { timeout: 5000 }) : load();
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}

export function onRouterTransitionStart(
  ...args: Parameters<typeof SentryModule.captureRouterTransitionStart>
) {
  sentry?.captureRouterTransitionStart(...args);
}
