import 'server-only';

import { cookies } from 'next/headers';

import { serverEnv } from '@/lib/env';
import { computeOrderAccessToken, verifyOrderAccessTokenWith } from '@/server/lib/order-token';

/**
 * Guest access to an order's result/payment page without an account (M2 foundation).
 * `placeOrder` calls `grantOrderAccess(code)`; email links carry `?t=<orderAccessToken(code)>`.
 * Signed members can also open their own orders by `user_id` (checked by the caller).
 */

const COOKIE_PREFIX = 'oa_';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The pure HMAC lives in `server/lib/order-token.ts` so the worker builds the same links. */
export function orderAccessToken(code: string): string {
  return computeOrderAccessToken(serverEnv().BETTER_AUTH_SECRET, code);
}

export function verifyOrderAccessToken(code: string, token: string | null | undefined): boolean {
  return verifyOrderAccessTokenWith(serverEnv().BETTER_AUTH_SECRET, code, token);
}

export async function grantOrderAccess(code: string): Promise<void> {
  const store = await cookies();
  store.set(`${COOKIE_PREFIX}${code}`, orderAccessToken(code), {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** True when this browser placed the order (cookie) or the link carries a valid token. */
export async function hasOrderAccess(code: string, token?: string | null): Promise<boolean> {
  if (verifyOrderAccessToken(code, token)) return true;
  const store = await cookies();
  return verifyOrderAccessToken(code, store.get(`${COOKIE_PREFIX}${code}`)?.value);
}
