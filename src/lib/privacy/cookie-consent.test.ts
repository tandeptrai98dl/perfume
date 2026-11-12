import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  COOKIE_CONSENT_ANSWERED_ATTRIBUTE,
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  cookieConsentPaintScript,
  consentModeState,
  CONSENT_MODE_DEFAULTS,
  isCurrentConsent,
  parseCookieConsent,
  readCookieConsent,
  serializeCookieConsent,
  trackingCookieNames,
  truncateIp,
} from './cookie-consent';

const consent = {
  version: COOKIE_CONSENT_VERSION,
  analytics: true,
  ads: false,
  decidedAt: 1_762_900_000,
  receiptId: '019a7c2e-1111-7aaa-8bbb-123456789abc',
};

describe('cookie consent value', () => {
  it('round-trips through the cookie format', () => {
    expect(parseCookieConsent(serializeCookieConsent(consent))).toEqual(consent);
  });

  it('reads the cookie from a header among other cookies (URL-encoded)', () => {
    const header = `NEXT_LOCALE=en; cookie_consent=${encodeURIComponent(serializeCookieConsent(consent))}; cart_token=x`;
    expect(readCookieConsent(header)).toEqual(consent);
    expect(readCookieConsent('NEXT_LOCALE=en')).toBeNull();
    expect(readCookieConsent(null)).toBeNull();
  });

  it('rejects malformed values instead of guessing', () => {
    expect(parseCookieConsent('')).toBeNull();
    expect(parseCookieConsent('v=1&a=yes&d=0&t=1')).toBeNull();
    expect(parseCookieConsent('v=1&a=1&d=0&t=-4')).toBeNull();
    expect(parseCookieConsent('a=1&d=0&t=4')).toBeNull();
    expect(parseCookieConsent('v=1&a=1&d=0&t=4&id=not-a-uuid')?.receiptId).toBeNull();
  });

  it('asks again when the notice version changed', () => {
    expect(isCurrentConsent(consent)).toBe(true);
    expect(isCurrentConsent({ ...consent, version: '2020-01-01' })).toBe(false);
    expect(isCurrentConsent(null)).toBe(false);
  });
});

describe('Consent Mode v2', () => {
  it('denies everything optional by default', () => {
    expect(CONSENT_MODE_DEFAULTS).toMatchObject({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
  });

  it('maps analytics and ads independently', () => {
    expect(consentModeState({ analytics: true, ads: false })).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    });
    expect(consentModeState({ analytics: false, ads: true }).ad_personalization).toBe('granted');
  });
});

describe('helpers', () => {
  it('finds GA4 / Meta cookies to remove on withdrawal', () => {
    expect(
      trackingCookieNames('_ga=1; _ga_ABC=2; _gid=3; _fbp=4; cart_token=5; cookie_consent=6'),
    ).toEqual(['_ga', '_ga_ABC', '_gid', '_fbp']);
  });

  it('truncates IPs for anonymous consent records', () => {
    expect(truncateIp('203.113.45.67')).toBe('203.113.45.0');
    expect(truncateIp('2001:db8:85a3:1:2:3:4:5')).toBe('2001:db8:85a3::');
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncateIp('999.1.1.1')).toBeNull();
    expect(truncateIp('not-an-ip')).toBeNull();
    expect(truncateIp(null)).toBeNull();
  });
});

describe('pre-paint script', () => {
  /** Runs the inline script against a fake document; returns the attribute it set, if any. */
  function run(cookie: string): string | undefined {
    const attributes: Record<string, string> = {};
    const document = {
      cookie,
      documentElement: {
        setAttribute: (name: string, value: string) => (attributes[name] = value),
      },
    };
    runInNewContext(cookieConsentPaintScript(), { document, URLSearchParams });
    return attributes[COOKIE_CONSENT_ANSWERED_ATTRIBUTE];
  }
  const value = (version: string) =>
    encodeURIComponent(serializeCookieConsent({ ...consent, version }));

  it('marks a current answer, among other cookies', () => {
    expect(run(`cart_token=abc; ${COOKIE_CONSENT_NAME}=${value(COOKIE_CONSENT_VERSION)}`)).toBe(
      'answered',
    );
  });

  it('agrees with readCookieConsent on old, missing and malformed values', () => {
    for (const cookie of [
      '',
      'cart_token=abc',
      `${COOKIE_CONSENT_NAME}=${value('2020-01-01')}`,
      `${COOKIE_CONSENT_NAME}=%E0%A4%A`,
      `x${COOKIE_CONSENT_NAME}=${value(COOKIE_CONSENT_VERSION)}`,
    ]) {
      expect(run(cookie)).toBeUndefined();
      expect(isCurrentConsent(readCookieConsent(cookie))).toBe(false);
    }
  });
});
