import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-hosted in Docker on a Vietnam-based cloud (ADR-0012).
  output: 'standalone',
  // Cache Components: 'use cache' + cacheTag for catalogue pages (ARCHITECTURE.md §14.1).
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  // Sentry loads parts of its runtime hooks dynamically, which file tracing cannot see.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/.pnpm/@sentry+*/node_modules/@sentry/**/*'],
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

/**
 * Sentry build integration. Source maps are uploaded only when SENTRY_AUTH_TOKEN (and
 * SENTRY_ORG / SENTRY_PROJECT) are set, e.g. in the deploy pipeline; otherwise the build is
 * unchanged apart from the server instrumentation Sentry needs at runtime.
 */
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
