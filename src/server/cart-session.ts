import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import type { Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { errorFields, logger } from '@/server/lib/logger';
import {
  CART_COOKIE,
  CART_TTL_DAYS,
  countCartItems,
  findActiveCart,
  getCartView,
  getOrCreateCart,
  mergeGuestCart,
  type CartRow,
  type CartView,
} from '@/server/modules/cart';

/*
 * Next-only cart session layer (§10.3, §12 data access). The only ways to reach a cart are the
 * caller's own httpOnly `cart_token` cookie (guest) or their session (member); no cart id ever
 * comes from the client. Reads never create a cart; `ensureCurrentCart` (Server Actions only)
 * creates one and sets the cookie.
 */

const MAX_AGE_SECONDS = CART_TTL_DAYS * 24 * 60 * 60;

export async function readCartToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CART_COOKIE)?.value;
  return value && value.length <= 128 ? value : null;
}

/** Sliding 30-day cookie, refreshed on every cart change (Server Actions / Route Handlers). */
export async function writeCartToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

async function clearCartToken(): Promise<void> {
  try {
    (await cookies()).delete(CART_COOKIE);
  } catch {
    // Server Components cannot change cookies; the stale token is harmless (converted cart).
  }
}

export type CurrentCart = { cart: CartRow | null; userId: string | null };

/**
 * Cart of the current request. Signed-in members whose browser still holds a guest cart get
 * it merged here as well, in case the sign-in hook missed it. Server Actions call this
 * directly (fresh after their own writes); renders use the per-request `getCurrentCart`.
 */
export async function loadCurrentCart(): Promise<CurrentCart> {
  const [session, token] = await Promise.all([getSession(), readCartToken()]);
  const userId = session?.user.id ?? null;
  const db = getDb();
  if (userId) {
    if (token) {
      try {
        await mergeGuestCart(db, { userId, guestToken: token });
      } catch (error) {
        logger.warn('cart.merge.failed', errorFields(error));
      }
    }
    return { cart: await findActiveCart(db, { userId }), userId };
  }
  if (!token) return { cart: null, userId: null };
  return { cart: await findActiveCart(db, { token }), userId: null };
}

/** Deduplicated per render (header badge + page share one lookup). */
export const getCurrentCart = cache(loadCurrentCart);

/** For Server Actions: the current cart, created (and the cookie set) when missing. */
export async function ensureCurrentCart(locale: Locale): Promise<CurrentCart & { cart: CartRow }> {
  const current = await loadCurrentCart();
  const db = getDb();
  if (current.userId) {
    const { cart } = current.cart
      ? { cart: current.cart }
      : await getOrCreateCart(db, { userId: current.userId }, locale);
    // A member no longer needs the guest token (its cart was merged above).
    if (await readCartToken()) await clearCartToken();
    return { cart, userId: current.userId };
  }
  const token = await readCartToken();
  const { cart, newToken } = current.cart
    ? { cart: current.cart, newToken: null }
    : await getOrCreateCart(db, { token }, locale);
  const cookieToken = newToken ?? token;
  if (cookieToken) await writeCartToken(cookieToken);
  return { cart, userId: null };
}

/** Keeps a guest's cookie alive for 30 days after each change (sliding, like the cart). */
export async function refreshCartCookie(current: CurrentCart): Promise<void> {
  if (current.userId || !current.cart) return;
  const token = await readCartToken();
  if (token) await writeCartToken(token);
}

export async function getCurrentCartView(locale: Locale): Promise<CartView> {
  const { cart, userId } = await getCurrentCart();
  return getCartView(getDb(), { cart, locale, userId });
}

export async function getCurrentCartCount(): Promise<number> {
  const { cart } = await getCurrentCart();
  return countCartItems(getDb(), cart?.id ?? null);
}
