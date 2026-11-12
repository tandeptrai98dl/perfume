import 'server-only';

import { getDb } from '@/server/db/client';
import { getTurnstileVerifier } from '@/server/integrations/turnstile';
import { rateLimitIpKey } from '@/server/lib/client-ip';
import { errorFields, logger } from '@/server/lib/logger';
import { consumeRateLimit, type RateLimitRule, type RateLimitScope } from '@/server/lib/rate-limit';

import { getClientIp } from './request-ip';

/**
 * Abuse guard for public Server Actions and Route Handlers (ARCHITECTURE.md §12): the shared
 * Postgres rate limit keyed by the trusted client IP, then (optionally) Cloudflare Turnstile.
 * Call it right after Zod validation; it is not a permission check.
 *
 * ```ts
 * // e.g. src/actions/reviews.ts
 * const guard = await guardRequest({
 *   scope: 'reviewSubmit',
 *   turnstile: { token: parsed.data.turnstileToken, action: 'review' },
 * });
 * if (!guard.ok) return { ok: false, error: guard.error }; // 'rateLimited' | 'captchaFailed'
 * ```
 *
 * - `scope`: a `RATE_LIMITS` key (or any name plus `rule`). `subject` defaults to the client
 *   IP (IPv6 by /64); pass e.g. a cart id to limit per cart instead.
 * - `turnstile`: omit for forms without a widget. Verified only when `TURNSTILE_SECRET_KEY`
 *   is set; the client renders `<TurnstileField>` with the same `action`.
 * - A database error in the limiter fails open (logged): the action itself then needs the
 *   database anyway. A Turnstile network error fails closed.
 */

export type GuardFailure = 'rateLimited' | 'captchaFailed';

export type GuardResult =
  { ok: true; ip: string | null } | { ok: false; error: GuardFailure; retryAfterMs: number };

export type GuardOptions = {
  scope: RateLimitScope | (string & {});
  rule?: RateLimitRule;
  subject?: string;
  turnstile?: { token: unknown; action?: string };
};

export async function guardRequest(options: GuardOptions): Promise<GuardResult> {
  const ip = await getClientIp();
  try {
    const limit = await consumeRateLimit(getDb(), {
      scope: options.scope,
      rule: options.rule,
      subject: options.subject ?? rateLimitIpKey(ip),
    });
    if (!limit.ok) {
      logger.warn('rate_limit.blocked', { scope: options.scope });
      return { ok: false, error: 'rateLimited', retryAfterMs: limit.retryAfterMs };
    }
  } catch (error) {
    logger.error('rate_limit.failed', { scope: options.scope, ...errorFields(error) });
  }

  if (options.turnstile) {
    const verifier = getTurnstileVerifier();
    if (verifier) {
      const { token, action } = options.turnstile;
      const result = await verifier.verify({
        token: typeof token === 'string' ? token : null,
        remoteIp: ip,
        expectedAction: action,
      });
      if (!result.success) {
        logger.warn('turnstile.rejected', { scope: options.scope, codes: result.errorCodes });
        return { ok: false, error: 'captchaFailed', retryAfterMs: 0 };
      }
    }
  }
  return { ok: true, ip };
}
