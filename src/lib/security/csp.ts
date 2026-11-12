/**
 * Content Security Policy and security headers (ARCHITECTURE.md §12 "HTTP headers",
 * ADR-0024). Pure functions: the proxy sets the page policy (`src/proxy.ts`, runtime env),
 * next.config.ts the static headers.
 *
 * No nonces: with Cache Components every page is (partially) prerendered and cached. The
 * static shell is built without a request, and an ISR-cached render replays the nonce of the
 * request that produced it, so a per-request nonce cannot match (measured on this build: the
 * shells' inline React/RSC scripts carry no nonce or a stale one). Scripts are therefore
 * limited to `'self'`, inline and a documented host allowlist; everything else (`object-src`,
 * `base-uri`, `form-action`, `frame-ancestors`, `connect-src`, …) is locked down. XSS defence
 * rests on React escaping and the rich-text allowlist sanitizer (§12 Input/output).
 */

/** Third-party origins by purpose; every entry is a deliberate, documented exception. */
export const CSP_HOSTS = {
  /** GTM + GA4 (loaded only after consent, §4.1). */
  googleTagManager: ['https://www.googletagmanager.com', 'https://*.googletagmanager.com'],
  googleAnalytics: ['https://*.google-analytics.com', 'https://*.analytics.google.com'],
  /** Meta Pixel (after consent). */
  metaPixel: ['https://connect.facebook.net', 'https://www.facebook.com'],
  /** Google Ads conversion/remarketing tags fired by GTM (after `ad_storage` consent). */
  googleAds: ['https://googleads.g.doubleclick.net', 'https://*.doubleclick.net'],
  /** Google Ads remarketing pixels. */
  googleAdsImages: ['https://www.google.com', 'https://www.google.com.vn'],
  /** Ministry of Industry and Trade notification badge image (footer). */
  moitBadge: ['https://online.gov.vn'],
  /** Cloudflare Turnstile (script + challenge iframe). */
  turnstile: ['https://challenges.cloudflare.com'],
  /**
   * Payment gateway pages the checkout may submit/redirect to (VNPay sandbox + production,
   * payOS hosted checkout). Navigations themselves are not governed by CSP, but `form-action`
   * also applies to redirects that follow a form submission.
   */
  paymentForms: ['https://sandbox.vnpayment.vn', 'https://pay.vnpay.vn', 'https://pay.payos.vn'],
} as const;

export type CspOptions = {
  /** Development adds `'unsafe-eval'` (React debugging) and the HMR websocket. */
  isDev: boolean;
  /** Site origin; `upgrade-insecure-requests` is sent only for https sites. */
  appUrl: string;
  /** Product media bucket/CDN (`NEXT_PUBLIC_MEDIA_BASE_URL`). */
  mediaBaseUrl?: string;
  /** Browser Sentry DSN: its ingest origin is allowed and becomes the default report URI. */
  sentryDsn?: string;
  /** VNPay payment page (`VNPAY_PAYMENT_URL`), if it is not one of the known hosts. */
  vnpayPaymentUrl?: string;
  /** Explicit report endpoint (`CSP_REPORT_URI`); overrides the Sentry default. */
  reportUri?: string;
  /** Sentry environment tag for reports. */
  environment?: string;
};

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Sentry's CSP report endpoint for a DSN (`https://<key>@<host>/<project>` →
 * `https://<host>/api/<project>/security/?sentry_key=<key>`).
 */
export function sentrySecurityEndpoint(dsn: string | undefined, environment?: string) {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!url.username || !project) return null;
    const endpoint = new URL(`${url.protocol}//${url.host}/api/${project}/security/`);
    endpoint.searchParams.set('sentry_key', url.username);
    if (environment) endpoint.searchParams.set('sentry_environment', environment);
    return endpoint.toString();
  } catch {
    return null;
  }
}

export function cspReportUri(options: CspOptions): string | null {
  return options.reportUri ?? sentrySecurityEndpoint(options.sentryDsn, options.environment);
}

function unique(values: (string | null | undefined | false)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/** The policy as a header value (directives joined by `; `). */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const media = origin(options.mediaBaseUrl);
  const sentry = origin(options.sentryDsn);
  const https = options.appUrl.startsWith('https://');
  const reportUri = cspReportUri(options);

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': unique([
      "'self'",
      // Next.js/React inline bootstrap and RSC payload scripts (see the header comment).
      "'unsafe-inline'",
      options.isDev && "'unsafe-eval'",
      ...CSP_HOSTS.googleTagManager,
      ...CSP_HOSTS.googleAnalytics,
      CSP_HOSTS.metaPixel[0],
      CSP_HOSTS.googleAds[0],
      ...CSP_HOSTS.turnstile,
    ]),
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': unique([
      "'self'",
      'data:',
      'blob:',
      media,
      ...CSP_HOSTS.googleTagManager,
      ...CSP_HOSTS.googleAnalytics,
      CSP_HOSTS.metaPixel[1],
      CSP_HOSTS.googleAds[1],
      ...CSP_HOSTS.googleAdsImages,
      ...CSP_HOSTS.moitBadge,
    ]),
    'font-src': ["'self'", 'data:'],
    'connect-src': unique([
      "'self'",
      options.isDev && 'ws:',
      sentry,
      ...CSP_HOSTS.googleTagManager,
      ...CSP_HOSTS.googleAnalytics,
      ...CSP_HOSTS.metaPixel,
      CSP_HOSTS.googleAds[1],
      ...CSP_HOSTS.turnstile,
    ]),
    'media-src': unique(["'self'", media]),
    'frame-src': unique([
      ...CSP_HOSTS.turnstile,
      CSP_HOSTS.googleTagManager[0],
      'https://td.doubleclick.net',
    ]),
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'form-action': unique(["'self'", ...CSP_HOSTS.paymentForms, origin(options.vnpayPaymentUrl)]),
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (https) parts.push('upgrade-insecure-requests');
  if (reportUri) parts.push(`report-uri ${reportUri}`, 'report-to csp');
  return parts.join('; ');
}

/** Header name for enforce vs report-only roll-out (`CSP_REPORT_ONLY`). */
export function cspHeaderName(reportOnly: boolean) {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/** `Reporting-Endpoints` value for `report-to csp`, or null without an endpoint. */
export function reportingEndpoints(options: CspOptions): string | null {
  const uri = cspReportUri(options);
  return uri ? `csp="${uri}"` : null;
}

/**
 * Policy for responses the proxy never sees: its matcher skips `/_next/*` and file-like paths
 * (`/robots.txt`, images), yet a miss there (`/wp-login.php`, `/_next/missing`) renders the
 * HTML not-found page. Same first-party rules as pages (ADR-0024) without the third-party
 * hosts; static files ignore it. Set from next.config.ts `headers()`.
 */
export const FALLBACK_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** next.config.ts `headers()` sources outside the proxy matcher (see src/proxy.ts `config`). */
export const FALLBACK_CSP_SOURCES = ['/_next/:path*', '/:path(.*\\..*)'] as const;

/** Strict policy for API/JSON/file responses, which never render HTML. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

/**
 * Headers for every response (next.config.ts `headers()`), independent of the page. HSTS is
 * ignored by browsers over plain http (localhost), so it is always sent.
 */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'browsing-topics=()',
      'camera=()',
      'display-capture=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
];
