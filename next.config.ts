import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { API_CONTENT_SECURITY_POLICY, STATIC_SECURITY_HEADERS } from './src/lib/security/csp';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Product media host (object storage / CDN), see src/lib/media-url.ts. */
const mediaBaseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // Self-hosted in Docker on a Vietnam-based cloud (ADR-0012).
  output: 'standalone',
  // Cache Components: 'use cache' + cacheTag for catalogue pages (ARCHITECTURE.md §14.1).
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  // Security headers on every response (§12). Pages get their nonce-based CSP from the proxy
  // (src/proxy.ts); API and file responses never render HTML and get a deny-all policy.
  async headers() {
    return [
      { source: '/:path*', headers: STATIC_SECURITY_HEADERS },
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: API_CONTENT_SECURITY_POLICY }],
      },
    ];
  },
  images: {
    remotePatterns: mediaBaseUrl ? [new URL(`${mediaBaseUrl}/**`)] : [],
  },
  // Sentry loads parts of its runtime hooks dynamically, which file tracing cannot see.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/.pnpm/@sentry+*/node_modules/@sentry/**/*',
      // Open Graph cards read the Fontsource WOFF files at runtime (src/server/seo/og-assets.ts).
      './node_modules/@fontsource/be-vietnam-pro/files/*-{400,600}-normal.woff',
      './node_modules/@fontsource/cormorant-garamond/files/*-500-normal.woff',
    ],
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
