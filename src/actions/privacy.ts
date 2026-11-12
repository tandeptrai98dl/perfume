'use server';

import 'server-only';

import { refresh } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import {
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  isCurrentConsent,
  parseCookieConsent,
  serializeCookieConsent,
  truncateIp,
  type CookieConsent,
} from '@/lib/privacy/cookie-consent';
import { getCustomerSession } from '@/server/auth/customer';
import { getSession } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getProducer } from '@/server/jobs/producer';
import { DomainError, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  accountConsentsSchema,
  accountPrivacyRequestSchema,
  confirmGuestPrivacyRequest,
  cookieChoiceSchema,
  guestPrivacyRequestSchema,
  recordCookieChoice,
  requestAccountPrivacy,
  startGuestPrivacyRequest,
  updateAccountConsents,
} from '@/server/modules/customer';
import { guardRequest } from '@/server/request-guard';
import { getClientIp } from '@/server/request-ip';

/**
 * Privacy Server Actions (PDPL 91/2025, Decree 356/2025): cookie choices, privacy centre and
 * the public request form. Each one: Zod validation → identity (customer session, or a rate
 * limit for public actions; there is no staff permission involved) → customer module command.
 * Results are typed with translation codes (`privacyCenter.errors.*`), never thrown.
 */

export type PrivacyErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'rateLimited'
  | 'notFound'
  | 'invalid'
  | 'conflict'
  | 'unexpected';

export type PrivacyActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: PrivacyErrorCode; fieldErrors: FieldIssue[] };

const CODE_PATTERN = /^[a-zA-Z]+$/;

function validationFailure(error: z.ZodError): PrivacyActionResult<never> {
  return {
    ok: false,
    error: 'validation',
    fieldErrors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
    })),
  };
}

function failure(error: unknown, action: string): PrivacyActionResult<never> {
  if (error instanceof DomainError) {
    const code: PrivacyErrorCode =
      error.code === 'notFound' || error.code === 'conflict' || error.code === 'invalid'
        ? error.code
        : 'unexpected';
    return { ok: false, error: code, fieldErrors: error.fieldErrors };
  }
  logger.error('privacy.action_failed', { action, ...errorFields(error) });
  return { ok: false, error: 'unexpected', fieldErrors: [] };
}

const rateLimited: PrivacyActionResult<never> = {
  ok: false,
  error: 'rateLimited',
  fieldErrors: [],
};

async function requestContext() {
  const list = await headers();
  return { ip: await getClientIp(), userAgent: list.get('user-agent') };
}

async function writeConsentCookie(consent: CookieConsent) {
  const jar = await cookies();
  jar.set(COOKIE_CONSENT_NAME, serializeCookieConsent(consent), {
    path: '/',
    maxAge: COOKIE_CONSENT_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: serverEnv().APP_URL.startsWith('https://'),
    // Read by the tag loader in the browser before it may load Google Tag Manager.
    httpOnly: false,
  });
}

// ---------- Cookie banner / preferences ----------

/** Shared limits (§12): `newsletterSignup`-style per-IP buckets with privacy-specific rules. */
const COOKIE_RULE = { limit: 30, windowMs: 60_000 };

/** Records a cookie choice in `consents` (truncated IP) and stores it in the cookie. */
export async function saveCookieConsentAction(
  raw: unknown,
): Promise<PrivacyActionResult<{ value: string }>> {
  const parsed = cookieChoiceSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const context = await requestContext();
  if (!(await guardRequest({ scope: 'cookieConsent', rule: COOKIE_RULE })).ok) return rateLimited;
  try {
    const session = await getSession();
    const receiptId = await recordCookieChoice(getDb(), {
      analytics: parsed.data.analytics,
      ads: parsed.data.ads,
      userId: session?.user.id ?? null,
      locale: parsed.data.locale,
      source: parsed.data.source,
      policyVersion: COOKIE_CONSENT_VERSION,
      context: { ip: truncateIp(context.ip), userAgent: context.userAgent },
    });
    const consent: CookieConsent = {
      version: COOKIE_CONSENT_VERSION,
      analytics: parsed.data.analytics,
      ads: parsed.data.ads,
      decidedAt: Math.floor(Date.now() / 1000),
      receiptId,
    };
    await writeConsentCookie(consent);
    return { ok: true, data: { value: serializeCookieConsent(consent) } };
  } catch (error) {
    return failure(error, 'cookie_consent');
  }
}

// ---------- Privacy centre (members) ----------

async function withCustomer<S extends z.ZodType, T>(
  schema: S,
  raw: unknown,
  action: string,
  command: (userId: string, input: z.output<S>) => Promise<T>,
): Promise<PrivacyActionResult<T>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const session = await getCustomerSession();
  if (!session) return { ok: false, error: 'unauthorized', fieldErrors: [] };
  try {
    const data = await command(session.user.id, parsed.data);
    refresh();
    return { ok: true, data };
  } catch (error) {
    return failure(error, action);
  }
}

export async function updateAccountConsentsAction(raw: unknown) {
  return withCustomer(accountConsentsSchema, raw, 'account_consents', async (userId, values) => {
    const jar = await cookies();
    const stored = parseCookieConsent(jar.get(COOKIE_CONSENT_NAME)?.value);
    const current = isCurrentConsent(stored) ? stored : null;
    const context = await requestContext();
    const result = await updateAccountConsents(getDb(), {
      userId,
      values,
      cookieChoice: current ? { analytics: current.analytics, ads: current.ads } : null,
      context: { ip: truncateIp(context.ip), userAgent: context.userAgent },
    });
    const consent: CookieConsent = {
      version: COOKIE_CONSENT_VERSION,
      analytics: values.analytics,
      ads: values.ads,
      decidedAt: Math.floor(Date.now() / 1000),
      receiptId: current?.receiptId ?? null,
    };
    await writeConsentCookie(consent);
    return { changed: result.changed, cookie: serializeCookieConsent(consent) };
  });
}

const ACCOUNT_REQUEST_RULE = { limit: 10, windowMs: 60 * 60_000 };

export async function requestAccountPrivacyAction(raw: unknown) {
  return withCustomer(
    accountPrivacyRequestSchema,
    raw,
    'account_request',
    async (userId, values) => {
      const guard = await guardRequest({
        scope: 'privacyAccountRequest',
        rule: ACCOUNT_REQUEST_RULE,
        subject: userId,
      });
      if (!guard.ok) {
        throw new DomainError('conflict', [{ path: 'type', code: 'rateLimited' }]);
      }
      const { request, created } = await requestAccountPrivacy(getDb(), await getProducer(), {
        userId,
        values,
      });
      return { id: request.id, created, dueAt: request.dueAt.toISOString() };
    },
  );
}

// ---------- Public request form (guests) ----------

const GUEST_EMAIL_RULE = { limit: 3, windowMs: 60 * 60_000 };

/**
 * Sends the confirmation link. Same answer for every e-mail (no enumeration); nothing is
 * stored before confirmation.
 */
export async function requestGuestPrivacyAction(raw: unknown): Promise<PrivacyActionResult> {
  const parsed = guestPrivacyRequestSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  if (!(await guardRequest({ scope: 'privacyRequest' })).ok) return rateLimited;
  // Silently drop repeats for one address: the person already has a link.
  const perEmail = await guardRequest({
    scope: 'privacyGuestEmail',
    rule: GUEST_EMAIL_RULE,
    subject: parsed.data.email.toLowerCase(),
  });
  if (!perEmail.ok) {
    return { ok: true, data: null };
  }
  try {
    const env = serverEnv();
    await startGuestPrivacyRequest(getDb(), await getProducer(), {
      values: parsed.data,
      secret: env.BETTER_AUTH_SECRET,
      appUrl: env.APP_URL,
    });
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'guest_request');
  }
}

const CONFIRM_RULE = { limit: 20, windowMs: 10 * 60_000 };

export async function confirmGuestPrivacyAction(
  raw: unknown,
): Promise<PrivacyActionResult<{ type: string; dueAt: string; status: string }>> {
  const parsed = z.object({ token: z.string().min(10).max(4096) }).safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  if (!(await guardRequest({ scope: 'privacyConfirm', rule: CONFIRM_RULE })).ok) return rateLimited;
  try {
    const { request } = await confirmGuestPrivacyRequest(getDb(), await getProducer(), {
      token: parsed.data.token,
      secret: serverEnv().BETTER_AUTH_SECRET,
    });
    return {
      ok: true,
      data: { type: request.type, dueAt: request.dueAt.toISOString(), status: request.status },
    };
  } catch (error) {
    return failure(error, 'guest_confirm');
  }
}
