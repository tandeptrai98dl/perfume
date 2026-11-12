'use server';

import 'server-only';

import { headers } from 'next/headers';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile';
import { getDb } from '@/server/db/client';
import { getProducer } from '@/server/jobs/producer';
import { errorFields, logger } from '@/server/lib/logger';
import {
  confirmNewsletterSubscription,
  newsletterConfirmSchema,
  newsletterSignupSchema,
  newsletterUnsubscribeSchema,
  startNewsletterSignup,
  unsubscribeNewsletter,
} from '@/server/modules/customer';
import { guardRequest } from '@/server/request-guard';
import { getClientIp } from '@/server/request-ip';

/**
 * Newsletter Server Actions (§2 Marketing, double opt-in). Public: Zod validation → shared
 * rate limit (+ Turnstile on sign-up) → customer module. No staff permission is involved; the
 * signed links are the authorisation for confirm / unsubscribe. Results carry translation
 * codes (`newsletter.errors.*`), never thrown errors.
 */

export type NewsletterErrorCode =
  'validation' | 'rateLimited' | 'captchaFailed' | 'invalidLink' | 'unexpected';

export type NewsletterActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: NewsletterErrorCode; fieldErrors: { path: string; code: string }[] };

const CODE_PATTERN = /^[a-zA-Z]+$/;

function validationFailure(error: z.ZodError): NewsletterActionResult<never> {
  return {
    ok: false,
    error: 'validation',
    fieldErrors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
    })),
  };
}

function failure(code: NewsletterErrorCode): NewsletterActionResult<never> {
  return { ok: false, error: code, fieldErrors: [] };
}

async function requestContext() {
  const list = await headers();
  return { ip: await getClientIp(), userAgent: list.get('user-agent') };
}

/** Per-address limit: repeats for one address are dropped silently (it already has a link). */
const SIGNUP_EMAIL_RULE = { limit: 3, windowMs: 60 * 60_000 };
const LINK_RULE = { limit: 20, windowMs: 10 * 60_000 };

/**
 * Sends the confirmation e-mail. The answer is the same for new, pending and already
 * subscribed addresses (no enumeration); nothing is stored before confirmation.
 */
export async function subscribeNewsletterAction(
  raw: unknown,
  turnstileToken?: unknown,
): Promise<NewsletterActionResult> {
  const parsed = newsletterSignupSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const guard = await guardRequest({
    scope: 'newsletterSignup',
    turnstile: { token: turnstileToken, action: TURNSTILE_ACTIONS.newsletter },
  });
  if (!guard.ok) return failure(guard.error);
  const perEmail = await guardRequest({
    scope: 'newsletterSignupEmail',
    rule: SIGNUP_EMAIL_RULE,
    subject: parsed.data.email,
  });
  if (!perEmail.ok) return { ok: true, data: null };
  try {
    const env = serverEnv();
    await startNewsletterSignup(getDb(), await getProducer(), {
      values: parsed.data,
      secret: env.BETTER_AUTH_SECRET,
      appUrl: env.APP_URL,
    });
    return { ok: true, data: null };
  } catch (error) {
    logger.error('newsletter.signup_failed', errorFields(error));
    return failure('unexpected');
  }
}

/** The explicit "Confirm" on the page behind the e-mailed link (scanner-safe). */
export async function confirmNewsletterAction(
  raw: unknown,
): Promise<NewsletterActionResult<{ alreadySubscribed: boolean }>> {
  const parsed = newsletterConfirmSchema.safeParse(raw);
  if (!parsed.success) return failure('invalidLink');
  if (!(await guardRequest({ scope: 'newsletterLink', rule: LINK_RULE })).ok) {
    return failure('rateLimited');
  }
  try {
    const result = await confirmNewsletterSubscription(getDb(), await getProducer(), {
      token: parsed.data.token,
      secret: serverEnv().BETTER_AUTH_SECRET,
      context: await requestContext(),
    });
    if (!result) return failure('invalidLink');
    return { ok: true, data: { alreadySubscribed: result.alreadySubscribed } };
  } catch (error) {
    logger.error('newsletter.confirm_failed', errorFields(error));
    return failure('unexpected');
  }
}

/** One button on the signed unsubscribe page. */
export async function unsubscribeNewsletterAction(raw: unknown): Promise<NewsletterActionResult> {
  const parsed = newsletterUnsubscribeSchema.safeParse(raw);
  if (!parsed.success) return failure('invalidLink');
  if (!(await guardRequest({ scope: 'newsletterLink', rule: LINK_RULE })).ok) {
    return failure('rateLimited');
  }
  try {
    const done = await unsubscribeNewsletter(getDb(), {
      ...parsed.data,
      secret: serverEnv().BETTER_AUTH_SECRET,
      context: await requestContext(),
      source: 'newsletter_unsubscribe',
    });
    return done ? { ok: true, data: null } : failure('invalidLink');
  } catch (error) {
    logger.error('newsletter.unsubscribe_failed', errorFields(error));
    return failure('unexpected');
  }
}
