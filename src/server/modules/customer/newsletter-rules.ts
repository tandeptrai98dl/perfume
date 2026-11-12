import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/*
 * Newsletter double opt-in and unsubscribe links (§2 Marketing, PDPL 91/2025). Pure and
 * secret-injected (BETTER_AUTH_SECRET), shared by Server Actions, the worker and tests
 * (ADR-0023). Each link type signs with its own prefix, so one token can never be replayed
 * as another (privacy-request tokens included).
 */

/** Where a sign-up form sits (stored in `newsletter_subscribers.source` and `consents`). */
export const NEWSLETTER_SOURCES = ['footer', 'home'] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/** The confirmation link of a sign-up stays valid this long. */
export const NEWSLETTER_CONFIRM_HOURS = 72;

export type NewsletterSignup = {
  email: string;
  locale: 'vi' | 'en';
  source: NewsletterSource;
};

const signupPayload = z.object({
  e: z.email().max(254),
  l: z.enum(['vi', 'en']),
  s: z.enum(NEWSLETTER_SOURCES),
  x: z.number().int().positive(),
});

function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Stateless token of the confirmation link: nothing is stored before the click. */
export function signNewsletterSignup(
  secret: string,
  signup: NewsletterSignup,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      e: signup.email.trim().toLowerCase(),
      l: signup.locale,
      s: signup.source,
      x: Math.floor(now.getTime() / 1000) + NEWSLETTER_CONFIRM_HOURS * 3600,
    }),
  ).toString('base64url');
  return `${payload}.${hmac(secret, `newsletter-signup:${payload}`)}`;
}

export function verifyNewsletterSignup(
  secret: string,
  token: string | null | undefined,
  now: Date = new Date(),
): NewsletterSignup | null {
  if (!token || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(hmac(secret, `newsletter-signup:${payload}`), signature)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = signupPayload.safeParse(raw);
  if (!parsed.success || parsed.data.x * 1000 < now.getTime()) return null;
  return { email: parsed.data.e, locale: parsed.data.l, source: parsed.data.s };
}

/**
 * Unsubscribe signature of a subscriber row. It never expires (links in old e-mails must keep
 * working) and carries no e-mail address; the row id is a random UUIDv7.
 */
export function signNewsletterUnsubscribe(secret: string, subscriberId: string): string {
  return hmac(secret, `newsletter-unsubscribe:${subscriberId}`).slice(0, 43);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyNewsletterUnsubscribe(
  secret: string,
  subscriberId: string | null | undefined,
  signature: string | null | undefined,
): boolean {
  if (!subscriberId || !signature || !UUID.test(subscriberId) || signature.length > 64) {
    return false;
  }
  return safeEqual(signNewsletterUnsubscribe(secret, subscriberId), signature);
}
