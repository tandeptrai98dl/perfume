import 'server-only';

import { cookies, headers } from 'next/headers';

import { getSession } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { CART_COOKIE, findActiveCart, type CartRow } from '@/server/modules/cart';

import { getClientIp } from './request-ip';

/*
 * Request-scoped context for the checkout page and its Server Actions (Next-only: cookies,
 * headers, session). Business rules stay in `@/server/modules/checkout`.
 */

export type CheckoutShopper = {
  userId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * The shopper's active cart: the member's cart when signed in (the cart stream merges the guest
 * cart on sign-in), otherwise the guest cart from the httpOnly `cart_token` cookie.
 */
export async function getCheckoutCart(): Promise<{
  cart: CartRow | null;
  shopper: CheckoutShopper;
}> {
  const [session, store] = await Promise.all([getSession(), cookies()]);
  const user = session?.user ?? null;
  const token = store.get(CART_COOKIE)?.value ?? null;
  const db = getDb();
  let cart: CartRow | null = null;
  if (user) cart = await findActiveCart(db, { userId: user.id });
  if (!cart && token) {
    const guest = await findActiveCart(db, { token });
    // Never use another member's cart through a copied cookie.
    if (guest && (!guest.userId || guest.userId === user?.id)) cart = guest;
  }
  const phone = (user as { phone?: string | null } | null)?.phone ?? null;
  return {
    cart,
    shopper: {
      userId: user?.id ?? null,
      name: user?.name ?? null,
      email: user?.email ?? null,
      phone,
    },
  };
}

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const [list, ip] = await Promise.all([headers(), getClientIp()]);
  return { ip, userAgent: list.get('user-agent') };
}
