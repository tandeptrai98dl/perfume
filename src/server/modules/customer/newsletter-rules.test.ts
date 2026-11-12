import { describe, expect, it } from 'vitest';

import { signGuestRequest } from './privacy-rules';
import {
  NEWSLETTER_CONFIRM_HOURS,
  signNewsletterSignup,
  signNewsletterUnsubscribe,
  verifyNewsletterSignup,
  verifyNewsletterUnsubscribe,
} from './newsletter-rules';
import { newsletterSignupSchema, newsletterUnsubscribeSchema } from './newsletter-schemas';

const SECRET = 'newsletter-secret-newsletter-secret-0123';
const NOW = new Date('2026-11-12T03:00:00Z');
const SUBSCRIBER = '019a7b2c-0000-7000-8000-000000000001';

describe('newsletter sign-up token', () => {
  it('round-trips the e-mail (normalised), locale and source', () => {
    const token = signNewsletterSignup(
      SECRET,
      { email: ' Lan.Nguyen@Example.com ', locale: 'en', source: 'home' },
      NOW,
    );
    expect(verifyNewsletterSignup(SECRET, token, NOW)).toEqual({
      email: 'lan.nguyen@example.com',
      locale: 'en',
      source: 'home',
    });
  });

  it(`expires after ${NEWSLETTER_CONFIRM_HOURS} hours`, () => {
    const token = signNewsletterSignup(
      SECRET,
      { email: 'a@example.com', locale: 'vi', source: 'footer' },
      NOW,
    );
    const justBefore = new Date(NOW.getTime() + NEWSLETTER_CONFIRM_HOURS * 3600_000 - 1000);
    const after = new Date(NOW.getTime() + NEWSLETTER_CONFIRM_HOURS * 3600_000 + 1000);
    expect(verifyNewsletterSignup(SECRET, token, justBefore)).not.toBeNull();
    expect(verifyNewsletterSignup(SECRET, token, after)).toBeNull();
  });

  it('rejects tampered payloads, other secrets and other token types', () => {
    const token = signNewsletterSignup(
      SECRET,
      { email: 'a@example.com', locale: 'vi', source: 'footer' },
      NOW,
    );
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ e: 'victim@example.com', l: 'vi', s: 'footer', x: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyNewsletterSignup(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
    expect(verifyNewsletterSignup('another-secret-another-secret-0123', token, NOW)).toBeNull();
    expect(verifyNewsletterSignup(SECRET, `${payload}.${signature}.x`, NOW)).toBeNull();
    expect(verifyNewsletterSignup(SECRET, null, NOW)).toBeNull();
    // A privacy-request token signed with the same secret is not a newsletter token.
    const privacy = signGuestRequest(
      SECRET,
      { email: 'a@example.com', type: 'export', locale: 'vi', details: null },
      NOW,
    );
    expect(verifyNewsletterSignup(SECRET, privacy, NOW)).toBeNull();
  });
});

describe('newsletter unsubscribe signature', () => {
  it('verifies only the signed subscriber id', () => {
    const signature = signNewsletterUnsubscribe(SECRET, SUBSCRIBER);
    expect(verifyNewsletterUnsubscribe(SECRET, SUBSCRIBER, signature)).toBe(true);
    expect(
      verifyNewsletterUnsubscribe(SECRET, '019a7b2c-0000-7000-8000-000000000002', signature),
    ).toBe(false);
    expect(verifyNewsletterUnsubscribe(SECRET, SUBSCRIBER, `${signature.slice(0, -1)}A`)).toBe(
      false,
    );
    expect(verifyNewsletterUnsubscribe(SECRET, 'not-a-uuid', signature)).toBe(false);
    expect(verifyNewsletterUnsubscribe(SECRET, SUBSCRIBER, null)).toBe(false);
  });
});

describe('newsletter sign-up schema', () => {
  it('requires a valid e-mail and the ticked consent box', () => {
    const ok = newsletterSignupSchema.safeParse({
      email: ' Khach@Example.com',
      consent: true,
      locale: 'vi',
      source: 'footer',
    });
    expect(ok.success && ok.data.email).toBe('khach@example.com');

    const missing = newsletterSignupSchema.safeParse({
      email: 'nope',
      consent: false,
      locale: 'vi',
      source: 'footer',
    });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['email', 'emailInvalid'],
      ['consent', 'consentRequired'],
    ]);
  });

  it('validates unsubscribe parameters', () => {
    expect(
      newsletterUnsubscribeSchema.safeParse({
        s: SUBSCRIBER,
        t: signNewsletterUnsubscribe(SECRET, SUBSCRIBER),
      }).success,
    ).toBe(true);
    expect(newsletterUnsubscribeSchema.safeParse({ s: 'x', t: 'y' }).success).toBe(false);
  });
});
