import { createHash } from 'node:crypto';

import { lt, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';

/**
 * Shared fixed-window rate limiter on the `rate_limits` table (ARCHITECTURE.md §12 "Rate
 * limiting", §6.2). One atomic `INSERT … ON CONFLICT DO UPDATE` per attempt, so every web
 * instance shares the counters and concurrent attempts cannot all slip through a stale read.
 * A window starts with the first attempt for a key and lasts `windowMs`; the next attempt
 * after that starts a new window.
 *
 * Usage (any Server Action / Route Handler; see also `guardRequest` in
 * `src/server/request-guard.ts`, which adds the trusted client IP and Turnstile):
 *
 * ```ts
 * const result = await consumeRateLimit(getDb(), {
 *   scope: 'reviewSubmit',            // a RATE_LIMITS key, or any string with `rule`
 *   subject: rateLimitIpKey(ip),      // who is limited: IP key, user id, cart id, …
 * });
 * if (!result.ok) return { ok: false, error: 'rateLimited' };
 * ```
 *
 * Keys are `scope:` + a SHA-256 of the subject, so raw IPs or e-mails are never stored and key
 * length is bounded. Expired rows are deleted hourly by the `system.prune-rate-limits` job.
 * No Next.js APIs: usable from the worker and tests.
 */

export type RateLimitRule = { limit: number; windowMs: number };

export type RateLimitResult = {
  ok: boolean;
  /** Attempts left in the current window after this one. */
  remaining: number;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
};

const MINUTE = 60_000;

/**
 * Named limits (§12). Add new scopes here so limits are reviewed in one place. Windows must
 * not exceed `MAX_WINDOW_MS` (expired rows are pruned after it).
 */
export const RATE_LIMITS = {
  /** Place order: 5/min/IP. */
  placeOrder: { limit: 5, windowMs: MINUTE },
  /** Guest order lookup (code + phone): 5 per 10 min per IP. */
  orderLookup: { limit: 5, windowMs: 10 * MINUTE },
  /** Coupon attempts: 10/min per cart (no brute-forcing codes). */
  couponAttempt: { limit: 10, windowMs: MINUTE },
  /** Header search suggestions (typed queries, debounced): 120/min/IP. */
  searchSuggestions: { limit: 120, windowMs: MINUTE },
  /** Review submissions (members and token links): 5 per 10 min per IP. */
  reviewSubmit: { limit: 5, windowMs: 10 * MINUTE },
  /** Privacy centre requests (access, deletion, …): 3 per hour per IP. */
  privacyRequest: { limit: 3, windowMs: 60 * MINUTE },
  /** Newsletter sign-up / consent changes from public forms: 5 per 10 min per IP. */
  newsletterSignup: { limit: 5, windowMs: 10 * MINUTE },
  /** Customer return requests (account and guest order pages): 5 per hour per IP. */
  returnRequest: { limit: 5, windowMs: 60 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/** Longest supported window; rows older than this are pruned. */
export const MAX_WINDOW_MS = 24 * 60 * MINUTE;

type Executor = Pick<Database, 'insert' | 'delete'>;

export function rateLimitKey(scope: string, subject: string): string {
  const digest = createHash('sha256').update(subject).digest('base64url').slice(0, 32);
  return `${scope}:${digest}`;
}

export type ConsumeRateLimitInput = {
  scope: RateLimitScope | (string & {});
  subject: string;
  /** Required for scopes outside `RATE_LIMITS`. */
  rule?: RateLimitRule;
  now?: Date;
};

function ruleFor(input: ConsumeRateLimitInput): RateLimitRule {
  const rule = input.rule ?? (RATE_LIMITS as Record<string, RateLimitRule>)[input.scope];
  if (!rule) throw new Error(`no rate limit rule for scope "${input.scope}"`);
  if (rule.windowMs > MAX_WINDOW_MS) throw new Error('rate limit window longer than 24 h');
  return rule;
}

/** Counts one attempt and says whether it is allowed (atomic across instances). */
export async function consumeRateLimit(
  db: Executor,
  input: ConsumeRateLimitInput,
): Promise<RateLimitResult> {
  const rule = ruleFor(input);
  const now = input.now ?? new Date();
  const key = rateLimitKey(input.scope, input.subject);
  const expiredAt = new Date(now.getTime() - rule.windowMs);
  // In ON CONFLICT … SET, column references are the existing row; both CASEs see the old values.
  const expired = sql`${rateLimits.windowStart} <= ${expiredAt.toISOString()}::timestamptz`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then ${now.toISOString()}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
  const count = row?.count ?? 1;
  const windowStart = row?.windowStart ?? now;
  if (count > rule.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowStart.getTime() + rule.windowMs - now.getTime()),
    };
  }
  return { ok: true, remaining: rule.limit - count, retryAfterMs: 0 };
}

/** Deletes counters whose window ended (hourly cron). Returns the number of rows removed. */
export async function pruneRateLimits(db: Executor, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - MAX_WINDOW_MS)))
    .returning({ key: rateLimits.key });
  return removed.length;
}

/** @deprecated Use `RATE_LIMITS.orderLookup`. */
export const ORDER_LOOKUP_LIMIT = RATE_LIMITS.orderLookup;
