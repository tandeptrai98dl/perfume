import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseClientEnv, parseServerEnv } from './env';

describe('parseServerEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it('rejects an invalid APP_URL with a readable message', () => {
    expect(() => parseServerEnv({ APP_URL: 'not-a-url' })).toThrow(EnvValidationError);
    try {
      parseServerEnv({ APP_URL: 'not-a-url' });
    } catch (error) {
      expect((error as EnvValidationError).issues[0]).toMatch(/^APP_URL:/);
    }
  });

  it('treats empty values as unset', () => {
    const env = parseServerEnv({ BETTER_AUTH_SECRET: '', GOOGLE_CLIENT_ID: '' });
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('requires real secrets in production', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseServerEnv({ NODE_ENV: 'production' })).toThrow(/INTERNAL_API_SECRET/);
    const env = parseServerEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      INTERNAL_API_SECRET: 'b'.repeat(32),
    });
    expect(env.BETTER_AUTH_SECRET).toBe('a'.repeat(32));
    expect(env.INTERNAL_API_SECRET).toBe('b'.repeat(32));
  });

  it('requires the Google client id and secret together', () => {
    expect(() => parseServerEnv({ GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe('parseClientEnv', () => {
  it('uses the default app name', () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_APP_NAME).toBe('Perfume Store');
  });
});

describe('AUTH_RATE_LIMIT', () => {
  const prod = {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    INTERNAL_API_SECRET: 'b'.repeat(32),
  };

  it('can only be turned off for localhost production builds (E2E)', () => {
    expect(() =>
      parseServerEnv({ ...prod, APP_URL: 'https://shop.example.vn', AUTH_RATE_LIMIT: 'off' }),
    ).toThrow(/AUTH_RATE_LIMIT/);
    expect(
      parseServerEnv({ ...prod, APP_URL: 'http://localhost:3200', AUTH_RATE_LIMIT: 'off' })
        .AUTH_RATE_LIMIT,
    ).toBe('off');
    expect(parseServerEnv(prod).AUTH_RATE_LIMIT).toBe('on');
  });
});

describe('M3 hardening variables', () => {
  const prod = {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    INTERNAL_API_SECRET: 'b'.repeat(32),
  };

  it('requires TRUSTED_IP_HEADER in production (except localhost builds) and lower-cases it', () => {
    expect(() => parseServerEnv({ ...prod, APP_URL: 'https://shop.example.vn' })).toThrow(
      /TRUSTED_IP_HEADER/,
    );
    expect(
      parseServerEnv({
        ...prod,
        APP_URL: 'https://shop.example.vn',
        TRUSTED_IP_HEADER: 'CF-Connecting-IP',
      }).TRUSTED_IP_HEADER,
    ).toBe('cf-connecting-ip');
    expect(parseServerEnv(prod).TRUSTED_IP_HEADER).toBeUndefined();
    expect(() => parseServerEnv({ TRUSTED_IP_HEADER: 'x forwarded' })).toThrow(/TRUSTED_IP_HEADER/);
  });

  it('validates the webhook IP allowlists', () => {
    const env = parseServerEnv({
      VNPAY_IPN_ALLOWED_IPS: '113.160.92.202, 203.171.19.0/24',
      PAYOS_WEBHOOK_ALLOWED_IPS: '2001:db8::/32',
    });
    expect(env.VNPAY_IPN_ALLOWED_IPS).toContain('113.160.92.202');
    expect(() => parseServerEnv({ VNPAY_IPN_ALLOWED_IPS: '113.160.92.999' })).toThrow(
      /VNPAY_IPN_ALLOWED_IPS: invalid IP or CIDR range: 113\.160\.92\.999/,
    );
  });

  it('defaults CSP to enforcing', () => {
    expect(parseServerEnv({}).CSP_REPORT_ONLY).toBe(false);
    expect(parseServerEnv({ CSP_REPORT_ONLY: 'true' }).CSP_REPORT_ONLY).toBe(true);
  });
});
