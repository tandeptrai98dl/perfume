'use server';

import 'server-only';

import { isIP } from 'node:net';

import { headers } from 'next/headers';

import { orderLookupSchema } from '@/lib/validation/account';
import { getDb } from '@/server/db/client';
import { grantOrderAccess } from '@/server/order-access';
import { errorFields, logger } from '@/server/lib/logger';
import { createRateLimiter, ORDER_LOOKUP_LIMIT } from '@/server/lib/rate-limit';
import { findOrderCodeForLookup } from '@/server/modules/order';

/**
 * Guest order lookup (§10.5): order code + phone, 5 attempts per 10 minutes per IP (§12).
 * One generic error for any mismatch (no hint whether the code or the phone was wrong). On
 * success the browser gets the signed per-order access cookie and opens the status page.
 */

const limiter = createRateLimiter(ORDER_LOOKUP_LIMIT);

export type OrderLookupResult =
  | { ok: true; code: string }
  | { ok: false; error: 'validation' | 'notFound' | 'rateLimited' | 'unexpected' };

/**
 * Client IP behind Cloudflare/Caddy. `cf-connecting-ip` and `x-real-ip` are set by the
 * proxies; the first `x-forwarded-for` entry is the fallback for direct deployments.
 */
async function clientKey(): Promise<string> {
  const list = await headers();
  const candidate =
    list.get('cf-connecting-ip') ??
    list.get('x-real-ip') ??
    list.get('x-forwarded-for')?.split(',')[0]?.trim();
  return candidate && isIP(candidate) ? candidate : 'unknown';
}

export async function lookupOrderAction(raw: unknown): Promise<OrderLookupResult> {
  const parsed = orderLookupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation' };
  if (!limiter.hit(`order-lookup:${await clientKey()}`).ok) {
    return { ok: false, error: 'rateLimited' };
  }
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
