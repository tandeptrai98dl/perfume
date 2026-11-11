'use server';

import { refresh } from 'next/cache';
import type { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { ensureCurrentCart, loadCurrentCart, refreshCartCookie } from '@/server/cart-session';
import { getDb } from '@/server/db/client';
import { errorFields, logger } from '@/server/lib/logger';
import {
  addCartItem,
  addToCartSchema,
  applyCartCoupon,
  applyCouponSchema,
  cartLocaleSchema,
  getCartView,
  giftOptionsSchema,
  removeCartCoupon,
  removeCartItem,
  removeCartItemSchema,
  setCartItemQuantity,
  setGiftOptions,
  updateCartItemSchema,
  type CartActionResult,
  type CartView,
  type CommandOutcome,
} from '@/server/modules/cart';

/*
 * Storefront cart Server Actions (§10.3). Each one validates its input with Zod first.
 * Customers need no permission, but ownership is enforced by construction: the cart is always
 * the caller's own (cookie or session, `src/server/cart-session.ts`), never an id from the
 * client, and item ids are matched together with that cart id in the module.
 * Mutations return the fresh cart view (mini-cart) and `refresh()` the current route so
 * Server Components (cart page, header badge) re-render with the new data.
 */

function failure<T>(outcome: Exclude<CommandOutcome<unknown>, { ok: true }>): CartActionResult<T> {
  if (outcome.reason === 'coupon') return { ok: false, error: 'coupon', coupon: outcome.coupon };
  return {
    ok: false,
    error: outcome.reason,
    ...(outcome.max !== undefined ? { max: outcome.max } : {}),
  };
}

async function freshView(locale: Locale): Promise<CartView> {
  const { cart, userId } = await loadCurrentCart();
  return getCartView(getDb(), { cart, locale, userId });
}

async function run<S extends z.ZodType, T>(
  schema: S,
  raw: unknown,
  body: (input: z.output<S>) => Promise<CartActionResult<T>>,
): Promise<CartActionResult<T>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation' };
  try {
    return await body(parsed.data);
  } catch (error) {
    logger.error('cart.action.failed', errorFields(error));
    return { ok: false, error: 'unexpected' };
  }
}

export type AddToCartResult = CartActionResult<{
  itemCount: number;
  quantity: number;
  capped: boolean;
  max: number | null;
}>;

export async function addToCart(raw: z.input<typeof addToCartSchema>): Promise<AddToCartResult> {
  return run(addToCartSchema, raw, async (input) => {
    const { cart } = await ensureCurrentCart(input.locale);
    const outcome = await addCartItem(getDb(), {
      cartId: cart.id,
      variantId: input.variantId,
      quantity: input.quantity,
      locale: input.locale,
    });
    if (!outcome.ok) return failure(outcome);
    const view = await freshView(input.locale);
    refresh();
    return {
      ok: true,
      data: {
        itemCount: view.itemCount,
        quantity: outcome.data.quantity,
        capped: outcome.data.capped,
        max: outcome.data.capped ? outcome.data.quantity : null,
      },
    };
  });
}

/** Mini-cart content when the sheet opens (read only: never creates a cart). */
export async function getCart(
  raw: z.input<typeof cartLocaleSchema>,
): Promise<CartActionResult<CartView>> {
  return run(cartLocaleSchema, raw, async (input) => ({
    ok: true,
    data: await freshView(input.locale),
  }));
}

export async function updateCartItem(
  raw: z.input<typeof updateCartItemSchema>,
): Promise<CartActionResult<CartView>> {
  return run(updateCartItemSchema, raw, async (input) => {
    const current = await loadCurrentCart();
    const cart = current.cart;
    if (!cart) return { ok: false, error: 'notFound' };
    await refreshCartCookie(current);
    const outcome = await setCartItemQuantity(getDb(), {
      cartId: cart.id,
      itemId: input.itemId,
      quantity: input.quantity,
    });
    refresh();
    if (!outcome.ok) return failure(outcome);
    return { ok: true, data: await freshView(input.locale) };
  });
}

export async function removeFromCart(
  raw: z.input<typeof removeCartItemSchema>,
): Promise<CartActionResult<CartView>> {
  return run(removeCartItemSchema, raw, async (input) => {
    const current = await loadCurrentCart();
    const cart = current.cart;
    if (!cart) return { ok: false, error: 'notFound' };
    await refreshCartCookie(current);
    const outcome = await removeCartItem(getDb(), { cartId: cart.id, itemId: input.itemId });
    refresh();
    if (!outcome.ok) return failure(outcome);
    return { ok: true, data: await freshView(input.locale) };
  });
}

export async function applyCoupon(
  raw: z.input<typeof applyCouponSchema>,
): Promise<CartActionResult<CartView>> {
  return run(applyCouponSchema, raw, async (input) => {
    const current = await loadCurrentCart();
    const { cart, userId } = current;
    if (!cart) return { ok: false, error: 'coupon', coupon: { reason: 'empty_cart' } };
    await refreshCartCookie(current);
    const outcome = await applyCartCoupon(getDb(), {
      cartId: cart.id,
      code: input.code,
      userId,
      locale: input.locale,
    });
    if (!outcome.ok) return failure(outcome);
    refresh();
    return { ok: true, data: await freshView(input.locale) };
  });
}

export async function removeCoupon(
  raw: z.input<typeof cartLocaleSchema>,
): Promise<CartActionResult<CartView>> {
  return run(cartLocaleSchema, raw, async (input) => {
    const current = await loadCurrentCart();
    const cart = current.cart;
    if (!cart) return { ok: false, error: 'notFound' };
    await refreshCartCookie(current);
    const outcome = await removeCartCoupon(getDb(), { cartId: cart.id });
    refresh();
    if (!outcome.ok) return failure(outcome);
    return { ok: true, data: await freshView(input.locale) };
  });
}

export async function updateGiftOptions(
  raw: z.input<typeof giftOptionsSchema>,
): Promise<CartActionResult<CartView>> {
  return run(giftOptionsSchema, raw, async (input) => {
    const current = await loadCurrentCart();
    const cart = current.cart;
    if (!cart) return { ok: false, error: 'notFound' };
    await refreshCartCookie(current);
    const outcome = await setGiftOptions(getDb(), {
      cartId: cart.id,
      giftWrap: input.giftWrap,
      giftMessage: input.giftMessage,
      hidePrices: input.hidePrices,
    });
    refresh();
    if (!outcome.ok) return failure(outcome);
    return { ok: true, data: await freshView(input.locale) };
  });
}
