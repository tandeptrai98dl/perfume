'use server';

import 'server-only';

import { orderLookupSchema } from '@/lib/validation/account';
import { getDb } from '@/server/db/client';
import { grantOrderAccess } from '@/server/order-access';
import { errorFields, logger } from '@/server/lib/logger';
import { findOrderCodeForLookup } from '@/server/modules/order';
import { guardRequest } from '@/server/request-guard';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile';

/**
 * Guest order lookup (§10.5): order code + phone, 5 attempts per 10 minutes per IP (§12,
 * shared Postgres limiter) and Cloudflare Turnstile when configured.
 * One generic error for any mismatch (no hint whether the code or the phone was wrong). On
 * success the browser gets the signed per-order access cookie and opens the status page.
 */

export type OrderLookupResult =
  | { ok: true; code: string }
  | {
      ok: false;
      error: 'validation' | 'notFound' | 'rateLimited' | 'captchaFailed' | 'unexpected';
    };

export async function lookupOrderAction(
  raw: unknown,
  turnstileToken?: unknown,
): Promise<OrderLookupResult> {
  const parsed = orderLookupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const guard = await guardRequest({
    scope: 'orderLookup',
    turnstile: { token: turnstileToken, action: TURNSTILE_ACTIONS.orderLookup },
  });
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const code = await findOrderCodeForLookup(getDb(), parsed.data);
    if (!code) return { ok: false, error: 'notFound' };
    await grantOrderAccess(code);
    return { ok: true, code };
  } catch (error) {
    logger.error('order_lookup.failed', errorFields(error));
    return { ok: false, error: 'unexpected' };
  }
}
