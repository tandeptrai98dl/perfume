import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/server/db/client';
import { cartItems, carts } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { availableQuantitySql } from '@/server/modules/inventory';
import { findCoupon } from '@/server/modules/promotion';
import { getCommerceSettings } from '@/server/modules/settings';
import { getFreeShippingThreshold } from '@/server/modules/shipping';

import { findActiveCart, getCartLines, type CartRow } from './queries';
import {
  capAddition,
  capUpdate,
  lineCap,
  mergeCartItems,
  mergeCartOptions,
  normalizeGiftMessage,
  type CouponRejectionDetail,
} from './rules';
import { CART_TTL_DAYS, hashCartToken, newCartToken } from './token';
import type { CartOwner, CartView } from './types';
import { buildCartView, emptyCartView } from './view';

/*
 * Cart commands (§10.3). Every write runs in a transaction that locks the cart row, so two
 * tabs changing the same cart serialize. Callers resolve the cart from the request's own
 * cookie/session and pass its id: item ids are always matched together with the cart id, so
 * a cart can only be changed through its owner (no IDOR on `itemId`).
 * The cart never reserves stock; caps use live availability and `placeOrder` re-checks.
 */

type Executor = Database | Tx;

export type CommandOutcome<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: 'notFound' | 'unavailable' | 'out_of_stock' | 'limit_reached';
      max?: number;
    }
  | { ok: false; reason: 'coupon'; coupon: CouponRejectionDetail };

export function cartExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Active cart for the owner, created when missing. Guests get a fresh random token (only its
 * hash is stored); the caller must persist `newToken` in the httpOnly cookie.
 */
export async function getOrCreateCart(
  db: Database,
  owner: CartOwner,
  locale: Locale,
): Promise<{ cart: CartRow; newToken: string | null }> {
  if (owner.userId) {
    const userId = owner.userId;
    const cart = await db.transaction(async (tx) => {
      // One active cart per member even when two requests race to create it.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cart:${userId}`}))`);
      const existing = await findActiveCart(tx, { userId });
      if (existing) return existing;
      const [created] = await tx
        .insert(carts)
        .values({ userId, locale, expiresAt: cartExpiry() })
        .returning();
      return created!;
    });
    return { cart, newToken: null };
  }

  if (owner.token) {
    const existing = await findActiveCart(db, { token: owner.token });
    if (existing) return { cart: existing, newToken: null };
  }
  // A new token every time: an expired cart may still hold the old token's hash.
  const token = newCartToken();
  const [created] = await db
    .insert(carts)
    .values({ tokenHash: hashCartToken(token), locale, expiresAt: cartExpiry() })
    .returning();
  return { cart: created!, newToken: token };
}

async function lockCart(tx: Tx, cartId: string): Promise<CartRow | null> {
  const [cart] = await tx
    .select()
    .from(carts)
    .where(and(eq(carts.id, cartId), eq(carts.status, 'active')))
    .for('update');
  return cart ?? null;
}

/** Sliding 30-day expiry: every change keeps the cart alive (cookie is refreshed alongside). */
async function touchCart(tx: Tx, cartId: string, patch: Partial<typeof carts.$inferInsert> = {}) {
  await tx
    .update(carts)
    .set({ ...patch, expiresAt: cartExpiry(), updatedAt: new Date() })
    .where(eq(carts.id, cartId));
}

type VariantOfferRow = {
  id: string;
  price: string | number;
  available: string | number;
  purchasable: boolean;
};

/** Live price, availability and whether the variant may be sold (same rules as cart lines). */
async function variantOffer(db: Executor, variantId: string) {
  const result = await db.execute<VariantOfferRow>(sql`
    select v.id, v.price, ${availableQuantitySql(sql`v.id`)} as available,
      (v.is_active and v.variant_type <> 'decant' and p.status = 'active' and p.deleted_at is null
        and b.status = 'active' and b.deleted_at is null and coalesce(pt_vi.is_published, false)
        and (p.published_at is null or p.published_at <= now())) as purchasable
    from product_variants v
    join products p on p.id = v.product_id
    join brands b on b.id = p.brand_id
    left join product_translations pt_vi on pt_vi.product_id = p.id and pt_vi.locale = 'vi'
    where v.id = ${variantId}`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    price: Number(row.price),
    available: Math.max(0, Number(row.available)),
    purchasable: row.purchasable,
  };
}

/** Adds units of a variant (PDP). The line is capped at min(available, per-line limit). */
export async function addCartItem(
  db: Database,
  input: { cartId: string; variantId: string; quantity: number; locale?: Locale },
): Promise<CommandOutcome<{ itemId: string; quantity: number; capped: boolean }>> {
  const { cart: settings } = await getCommerceSettings(db);
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    const offer = await variantOffer(tx, input.variantId);
    if (!offer || !offer.purchasable) return { ok: false, reason: 'unavailable' };

    const [existing] = await tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, input.variantId)));
    const capped = capAddition(
      existing?.quantity ?? 0,
      input.quantity,
      lineCap(offer.available, settings.maxQuantityPerLine),
    );
    if (!capped.ok) return { ok: false, reason: capped.reason, max: capped.max };

    // Re-adding from the product page means the customer saw the current price.
    const [item] = await tx
      .insert(cartItems)
      .values({
        cartId: cart.id,
        variantId: input.variantId,
        quantity: capped.quantity,
        priceWhenAdded: offer.price,
      })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { quantity: capped.quantity, priceWhenAdded: offer.price, updatedAt: new Date() },
      })
      .returning({ id: cartItems.id });
    await touchCart(tx, cart.id, input.locale ? { locale: input.locale } : {});
    return {
      ok: true,
      data: { itemId: item!.id, quantity: capped.quantity, capped: capped.capped },
    };
  });
}

/** Sets a line's quantity (stepper); 0 removes it. Capped like `addCartItem`. */
export async function setCartItemQuantity(
  db: Database,
  input: { cartId: string; itemId: string; quantity: number },
): Promise<CommandOutcome<{ quantity: number; capped: boolean }>> {
  if (input.quantity <= 0) {
    const removed = await removeCartItem(db, input);
    return removed.ok ? { ok: true, data: { quantity: 0, capped: false } } : removed;
  }
  const { cart: settings } = await getCommerceSettings(db);
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    const [item] = await tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, cart.id)));
    if (!item) return { ok: false, reason: 'notFound' };
    const offer = await variantOffer(tx, item.variantId);
    if (!offer || !offer.purchasable) return { ok: false, reason: 'unavailable' };
    const capped = capUpdate(input.quantity, lineCap(offer.available, settings.maxQuantityPerLine));
    if (!capped.ok) return { ok: false, reason: capped.reason, max: capped.max };
    await tx
      .update(cartItems)
      .set({ quantity: capped.quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, item.id));
    await touchCart(tx, cart.id);
    return { ok: true, data: { quantity: capped.quantity, capped: capped.capped } };
  });
}

export async function removeCartItem(
  db: Database,
  input: { cartId: string; itemId: string },
): Promise<CommandOutcome<null>> {
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    const deleted = await tx
      .delete(cartItems)
      .where(and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, cart.id)))
      .returning({ id: cartItems.id });
    if (deleted.length === 0) return { ok: false, reason: 'notFound' };
    await touchCart(tx, cart.id);
    return { ok: true, data: null };
  });
}

/** Gift wrap (fee from settings), card message ≤ 200 characters, hide prices on the slip. */
export async function setGiftOptions(
  db: Database,
  input: { cartId: string; giftWrap: boolean; giftMessage: string | null; hidePrices: boolean },
): Promise<CommandOutcome<null>> {
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    await touchCart(tx, cart.id, {
      giftWrap: input.giftWrap,
      giftMessage: normalizeGiftMessage(input.giftMessage),
      hidePrices: input.hidePrices,
    });
    return { ok: true, data: null };
  });
}

type ViewContext = {
  maxQuantityPerLine: number;
  giftWrapFee: number;
  freeShippingThreshold: number | null;
};

async function viewContext(db: Executor): Promise<ViewContext> {
  // Sequential: `db` may be a transaction (one connection, no concurrent queries).
  const settings = await getCommerceSettings(db);
  const freeShippingThreshold = await getFreeShippingThreshold(db);
  return {
    maxQuantityPerLine: settings.cart.maxQuantityPerLine,
    giftWrapFee: settings.giftWrapFee,
    freeShippingThreshold,
  };
}

/**
 * Validates a code against the current cart (dates and limits by `findCoupon`, minimum
 * subtotal and scope by `priceCart`) and stores it only when it applies. Members are checked
 * against their per-customer limit; guests are checked again at checkout with their phone.
 */
export async function applyCartCoupon(
  db: Database,
  input: { cartId: string; code: string; userId?: string | null; locale: Locale },
): Promise<CommandOutcome<{ code: string }>> {
  const code = input.code.trim();
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    const lines = await getCartLines(tx, { cartId: cart.id, locale: input.locale });
    const context = await viewContext(tx);
    const lookup = await findCoupon(
      tx,
      code,
      input.userId ? { customer: { userId: input.userId } } : {},
    );
    const view = buildCartView({
      ...context,
      cart: { ...cart, couponCode: code },
      lines,
      coupon: lookup,
    });
    if (view.lines.every((line) => line.issues.unavailable)) {
      return { ok: false, reason: 'coupon', coupon: { reason: 'empty_cart' } };
    }
    if (!view.coupon?.applied) {
      return {
        ok: false,
        reason: 'coupon',
        coupon: view.coupon?.rejection ?? { reason: 'not_found' },
      };
    }
    await touchCart(tx, cart.id, { couponCode: view.coupon.code });
    return { ok: true, data: { code: view.coupon.code } };
  });
}

export async function removeCartCoupon(
  db: Database,
  input: { cartId: string },
): Promise<CommandOutcome<null>> {
  return db.transaction(async (tx) => {
    const cart = await lockCart(tx, input.cartId);
    if (!cart) return { ok: false, reason: 'notFound' };
    await touchCart(tx, cart.id, { couponCode: null });
    return { ok: true, data: null };
  });
}

/**
 * Cart as displayed (mini-cart, cart page): live prices, flags and totals. The stored coupon
 * is re-validated on every read, so an expired code or a subtotal below its minimum shows the
 * reason instead of a stale discount.
 */
export async function getCartView(
  db: Executor,
  input: { cart: CartRow | null; locale: Locale; userId?: string | null },
): Promise<CartView> {
  const context = await viewContext(db);
  if (!input.cart) return emptyCartView(context);
  const cart = input.cart;
  const lines = await getCartLines(db, { cartId: cart.id, locale: input.locale });
  const coupon = cart.couponCode
    ? await findCoupon(
        db,
        cart.couponCode,
        input.userId ? { customer: { userId: input.userId } } : {},
      )
    : null;
  return buildCartView({ ...context, cart, lines, coupon });
}

/** Number of units in a cart, for the header badge (no prices needed). */
export async function countCartItems(db: Executor, cartId: string | null): Promise<number> {
  if (!cartId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row?.n ?? 0;
}

/**
 * Sign-in merge (§10.3). The guest cart behind `guestToken` is merged into the member's
 * active cart: quantities summed and capped by stock and the per-line limit, coupon and gift
 * options kept (guest wins when set), and the guest cart marked `converted`. Without a member
 * cart the guest cart is adopted (its token is cleared, so the cookie no longer opens it after
 * sign-out). Idempotent: an already merged guest cart is no longer active.
 */
export async function mergeGuestCart(
  db: Database,
  input: { userId: string; guestToken: string; locale?: Locale },
): Promise<{ merged: boolean; cartId: string | null }> {
  const { cart: settings } = await getCommerceSettings(db);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cart:${input.userId}`}))`);
    const [guest] = await tx
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.tokenHash, hashCartToken(input.guestToken)),
          eq(carts.status, 'active'),
          isNull(carts.userId),
          sql`${carts.expiresAt} > now()`,
        ),
      )
      .for('update');
    if (!guest) return { merged: false, cartId: null };

    const member = await findActiveCart(tx, { userId: input.userId });
    if (!member) {
      await touchCart(tx, guest.id, {
        userId: input.userId,
        tokenHash: null,
        ...(input.locale ? { locale: input.locale } : {}),
      });
      return { merged: true, cartId: guest.id };
    }

    const memberItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, member.id));
    const guestItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
    const variantIds = [...new Set(guestItems.map((item) => item.variantId))];
    const caps = new Map<string, number>();
    for (const variantId of variantIds) {
      const offer = await variantOffer(tx, variantId);
      caps.set(
        variantId,
        offer?.purchasable ? lineCap(offer.available, settings.maxQuantityPerLine) : 0,
      );
    }
    const writes = mergeCartItems(memberItems, guestItems, (id) => caps.get(id) ?? 0);
    for (const write of writes) {
      await tx
        .insert(cartItems)
        .values({ cartId: member.id, ...write })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          set: { quantity: write.quantity, updatedAt: new Date() },
        });
    }
    const options = mergeCartOptions(member, guest);
    await touchCart(tx, member.id, {
      ...options,
      ...(input.locale ? { locale: input.locale } : {}),
    });
    await tx
      .update(carts)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(eq(carts.id, guest.id));
    return { merged: true, cartId: member.id };
  });
}

/**
 * Better Auth `session.create.after` helper: merges the guest cart named by the request's
 * `cart_token` cookie. Never throws (a failed merge must not block sign-in); the cart session
 * layer retries lazily on the next request.
 */
export async function mergeGuestCartFromCookieHeader(
  db: Database,
  userId: string,
  cookieHeader: string | null | undefined,
  cookieName: string,
): Promise<boolean> {
  const token = readCookie(cookieHeader, cookieName);
  if (!token) return false;
  const result = await mergeGuestCart(db, { userId, guestToken: token });
  return result.merged;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}
