import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  cspHeaderName,
  reportingEndpoints,
  sentrySecurityEndpoint,
  STATIC_SECURITY_HEADERS,
} from './csp';

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name = '', ...values] = part.split(' ');
      return [name, values];
    }),
  );
}

const base = { isDev: false, appUrl: 'https://shop.example.vn' };

describe('buildContentSecurityPolicy', () => {
  it('allows scripts from self, inline (Cache Components shells) and the documented hosts', () => {
    const csp = directives(buildContentSecurityPolicy(base));
    expect(csp['script-src']).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://www.googletagmanager.com',
      'https://*.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://connect.facebook.net',
      'https://challenges.cloudflare.com',
    ]);
    // No eval in production; no nonce (it would disable 'unsafe-inline' and cannot match
    // prerendered/ISR shells, ADR-0024).
    expect(csp['script-src']?.some((value) => value.startsWith("'nonce-"))).toBe(false);
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('locks down framing, plugins, base and form targets', () => {
    const csp = directives(buildContentSecurityPolicy(base));
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual([
      "'self'",
      'https://sandbox.vnpayment.vn',
      'https://pay.vnpay.vn',
      'https://pay.payos.vn',
    ]);
    expect(csp['frame-src']).toContain('https://challenges.cloudflare.com');
    expect(csp['connect-src']).toEqual(
      expect.arrayContaining(['https://*.google-analytics.com', 'https://*.analytics.google.com']),
    );
    expect(csp['upgrade-insecure-requests']).toEqual([]);
  });

  it('adds media, Sentry and a custom VNPay host, and dev-only allowances', () => {
    const csp = directives(
      buildContentSecurityPolicy({
        ...base,
        isDev: true,
        appUrl: 'http://localhost:3000',
        mediaBaseUrl: 'https://cdn.example.vn/media',
        sentryDsn: 'https://abc123@o42.ingest.sentry.io/7',
        vnpayPaymentUrl: 'https://vnpay.example.vn/paymentv2/vpcpay.html',
      }),
    );
    expect(csp['img-src']).toContain('https://cdn.example.vn');
    expect(csp['connect-src']).toEqual(
      expect.arrayContaining(['https://o42.ingest.sentry.io', 'ws:']),
    );
    expect(csp['script-src']).toContain("'unsafe-eval'");
    expect(csp['form-action']).toContain('https://vnpay.example.vn');
    // Plain http (localhost): no upgrade, which would break the dev server.
    expect(csp['upgrade-insecure-requests']).toBeUndefined();
    expect(csp['report-uri']).toEqual([
      'https://o42.ingest.sentry.io/api/7/security/?sentry_key=abc123',
    ]);
    expect(csp['report-to']).toEqual(['csp']);
  });

  it('prefers an explicit report URI', () => {
    const options = { ...base, reportUri: 'https://csp.example.vn/r', sentryDsn: 'https://k@h/1' };
    expect(directives(buildContentSecurityPolicy(options))['report-uri']).toEqual([
      'https://csp.example.vn/r',
    ]);
    expect(reportingEndpoints(options)).toBe('csp="https://csp.example.vn/r"');
    expect(reportingEndpoints(base)).toBeNull();
  });
});

describe('helpers', () => {
  it('derives the Sentry security endpoint from a DSN', () => {
    expect(sentrySecurityEndpoint('https://key@o1.ingest.de.sentry.io/99', 'production')).toBe(
      'https://o1.ingest.de.sentry.io/api/99/security/?sentry_key=key&sentry_environment=production',
    );
    expect(sentrySecurityEndpoint('not a url')).toBeNull();
    expect(sentrySecurityEndpoint(undefined)).toBeNull();
  });

  it('switches to report-only by name', () => {
    expect(cspHeaderName(false)).toBe('Content-Security-Policy');
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only');
  });

  it('sends HSTS, nosniff, referrer and permissions policies on every response', () => {
    const byKey = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(byKey['Permissions-Policy']).toContain('camera=()');
    expect(byKey['X-Frame-Options']).toBe('DENY');
  });
});
