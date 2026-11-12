'use server';

import 'server-only';

import { isIP } from 'node:net';

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { DomainError, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { createRateLimiter } from '@/server/lib/rate-limit';
import {
  guestReviewSchema,
  memberReviewSchema,
  submitGuestReview,
  submitMemberReview,
} from '@/server/modules/review';

/**
 * Review Server Actions (ADR-0008). Zod first, then the permission: members need their session
 * (the module checks the order line is theirs and delivered); guests need the one-time token
 * from the e-mail (checked, single use, 30 days). Submissions are rate limited per member and
 * per IP. Results carry translation codes (`reviews.errors.*`).
 */

const memberLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const guestLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export type ReviewErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'notFound'
  | 'alreadyReviewed'
  | 'linkExpired'
  | 'notReviewable'
  | 'rateLimited'
  | 'unexpected';

export type ReviewActionResult =
  { ok: true } | { ok: false; error: ReviewErrorCode; fieldErrors: FieldIssue[] };

const CODE_PATTERN = /^[a-zA-Z]+$/;
const localeSchema = z.enum(['vi', 'en']);

function validationFailure(error: z.ZodError): ReviewActionResult {
  return {
    ok: false,
    error: 'validation',
    fieldErrors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
    })),
  };
}

function domainFailure(error: unknown, scope: string): ReviewActionResult {
  if (error instanceof DomainError) {
    const specific = error.fieldErrors[0]?.code;
    const code: ReviewErrorCode =
      specific === 'alreadyReviewed' || specific === 'linkExpired' || specific === 'notReviewable'
        ? specific
        : error.code === 'notFound'
          ? 'notFound'
          : 'unexpected';
    return { ok: false, error: code, fieldErrors: [] };
  }
  logger.error(`${scope}.failed`, errorFields(error));
  return { ok: false, error: 'unexpected', fieldErrors: [] };
}

async function clientIp(): Promise<string> {
  const list = await headers();
  const candidate =
    list.get('cf-connecting-ip') ??
    list.get('x-real-ip') ??
    list.get('x-forwarded-for')?.split(',')[0]?.trim();
  return candidate && isIP(candidate) ? candidate : 'unknown';
}

const memberInput = z.object({ locale: localeSchema, review: memberReviewSchema });
const guestInput = z.object({ locale: localeSchema, review: guestReviewSchema });

/** Member review of an own delivered order line, from the account. */
export async function submitMemberReviewAction(raw: unknown): Promise<ReviewActionResult> {
  const parsed = memberInput.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const session = await getCustomerSession();
  if (!session) return { ok: false, error: 'unauthorized', fieldErrors: [] };
  if (!memberLimiter.hit(`review:user:${session.user.id}`).ok) {
    return { ok: false, error: 'rateLimited', fieldErrors: [] };
  }
  try {
    const { orderItemId, ...values } = parsed.data.review;
    await submitMemberReview(getDb(), {
      userId: session.user.id,
      orderItemId,
      locale: parsed.data.locale,
      values,
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return domainFailure(error, 'review.member_submit');
  }
}

/** Guest review through the e-mailed one-time link. */
export async function submitGuestReviewAction(raw: unknown): Promise<ReviewActionResult> {
  const parsed = guestInput.safeParse(raw);
  if (!parsed.success) return validationFailure(parsed.error);
  if (!guestLimiter.hit(`review:ip:${await clientIp()}`).ok) {
    return { ok: false, error: 'rateLimited', fieldErrors: [] };
  }
  try {
    const { token, ...values } = parsed.data.review;
    await submitGuestReview(getDb(), { token, locale: parsed.data.locale, values });
    // No refresh(): the link page would re-render as "already used" over the thank-you note.
    return { ok: true };
  } catch (error) {
    return domainFailure(error, 'review.guest_submit');
  }
}
