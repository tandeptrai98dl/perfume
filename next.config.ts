import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import {
  API_CONTENT_SECURITY_POLICY,
  FALLBACK_CONTENT_SECURITY_POLICY,
  FALLBACK_CSP_SOURCES,
  STATIC_SECURITY_HEADERS,
} from './src/lib/security/csp';

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
  // Pages with a prerendered shell stream their request-time metadata (APP_URL is read at
  // runtime, §14.1), which puts <title>, description, canonical and hreflang in <body>.
  // Crawlers matching this list get blocking metadata in <head> instead. Next's default list
  // (next/dist/shared/lib/router/utils/html-bots) plus Googlebot: Google only honours
  // rel=canonical and hreflang in <head> (§13.1). Shoppers keep the streamed response.
  htmlLimitedBots:
    /Googlebot|[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i,
  // Security headers on every response (§12). Pages get their CSP from the proxy
  // (src/proxy.ts); paths outside its matcher get a first-party fallback (their 404 is HTML);
  // API responses never render HTML and get a deny-all policy (listed last: it wins).
  async headers() {
    return [
      { source: '/:path*', headers: STATIC_SECURITY_HEADERS },
      ...FALLBACK_CSP_SOURCES.map((source) => ({
        source,
        headers: [{ key: 'Content-Security-Policy', value: FALLBACK_CONTENT_SECURITY_POLICY }],
      })),
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
