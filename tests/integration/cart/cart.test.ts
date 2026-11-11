import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuth, type Auth } from '@/server/auth/config';
import { createDb, type Database } from '@/server/db/client';
import {
  cartItems,
  carts,
  couponRedemptions,
  coupons,
  inventoryItems,
  orders,
  productVariants,
  users,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import {
  addCartItem,
  applyCartCoupon,
  CART_COOKIE,
  findActiveCart,
  getCartView,
  getOrCreateCart,
  hashCartToken,
  mergeGuestCart,
  removeCartCoupon,
  removeCartItem,
  setCartItemQuantity,
  setGiftOptions,
} from '@/server/modules/cart';
import { generateOrderCode } from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Cart commands against a real database with the demo seed (§10.3): creation, caps, coupons,
 * gift options, expiry, ownership and the sign-in merge through Better Auth.
 */

const APP_URL = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let auth: Auth;

/** Demo variants by SKU-independent key: price and seeded stock. */
const variants: Record<'edt100' | 'edt50' | 'edp100' | 'parfum50', string> = {
  edt100: '',
  edt50: '',
  edp100: '',
  parfum50: '',
};

async function variantByPrice(price: number) {
  const [row] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.price, price));
  return row!.id;
}

async function setAvailable(variantId: string, onHand: number) {
  await db
    .update(inventoryItems)
    .set({ onHand, reserved: 0 })
    .where(eq(inventoryItems.variantId, variantId));
}

async function guestCart() {
  const { cart, newToken } = await getOrCreateCart(db, {}, 'vi');
  return { cart, token: newToken! };
}

async function items(cartId: string) {
  const rows = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
  return Object.fromEntries(rows.map((row) => [row.variantId, row.quantity]));
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  auth = createAuth(db, {
    APP_URL,
    BETTER_AUTH_SECRET: 'integration-test-secret-integration-test-secret',
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  });
  variants.edt100 = await variantByPrice(3_200_000);
  variants.edt50 = await variantByPrice(2_300_000);
  variants.edp100 = await variantByPrice(3_900_000);
  variants.parfum50 = await variantByPrice(5_400_000);
});

beforeEach(async () => {
  await setAvailable(variants.edt100, 12);
  await setAvailable(variants.edt50, 8);
  await setAvailable(variants.edp100, 5);
  await setAvailable(variants.parfum50, 4);
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('guest cart', () => {
  it('creates a cart for a new token and stores only its hash', async () => {
    const { cart, token } = await guestCart();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(cart.tokenHash).toBe(hashCartToken(token));
    expect(cart.userId).toBeNull();
    expect(cart.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    // Same token → same cart, no new token.
    const again = await getOrCreateCart(db, { token }, 'vi');
    expect(again).toEqual({ cart: expect.objectContaining({ id: cart.id }), newToken: null });
  });

  it('ignores expired carts and issues a fresh token instead', async () => {
    const { cart, token } = await guestCart();
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.id, cart.id));
    expect(await findActiveCart(db, { token })).toBeNull();
    const next = await getOrCreateCart(db, { token }, 'vi');
    expect(next.cart.id).not.toBe(cart.id);
    expect(next.newToken).not.toBe(token);
  });
});

describe('quantity cap', () => {
  it('caps a line at the per-line limit (5) and then refuses more', async () => {
    const { cart } = await guestCart();
    const first = await addCartItem(db, {
      cartId: cart.id,
      variantId: variants.edt100,
      quantity: 3,
    });
    expect(first).toMatchObject({ ok: true, data: { quantity: 3, capped: false } });
    const second = await addCartItem(db, {
      cartId: cart.id,
      variantId: variants.edt100,
      quantity: 4,
    });
    expect(second).toMatchObject({ ok: true, data: { quantity: 5, capped: true } });
    const third = await addCartItem(db, {
      cartId: cart.id,
      variantId: variants.edt100,
      quantity: 1,
    });
    expect(third).toEqual({ ok: false, reason: 'limit_reached', max: 5 });
  });

  it('caps at available stock and refuses out-of-stock or unsellable variants', async () => {
    const { cart } = await guestCart();
    await setAvailable(variants.parfum50, 2);
    expect(
      await addCartItem(db, { cartId: cart.id, variantId: variants.parfum50, quantity: 5 }),
    ).toMatchObject({ ok: true, data: { quantity: 2, capped: true } });

    await setAvailable(variants.edp100, 0);
    expect(
      await addCartItem(db, { cartId: cart.id, variantId: variants.edp100, quantity: 1 }),
    ).toEqual({ ok: false, reason: 'out_of_stock', max: 0 });

    await db
      .update(productVariants)
      .set({ isActive: false })
      .where(eq(productVariants.id, variants.edt50));
    try {
      expect(
        await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 }),
      ).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      await db
        .update(productVariants)
        .set({ isActive: true })
        .where(eq(productVariants.id, variants.edt50));
    }
  });

  it('caps stepper updates, removes at zero and flags stock that dropped since', async () => {
    const { cart } = await guestCart();
    const added = await addCartItem(db, {
      cartId: cart.id,
      variantId: variants.edt100,
      quantity: 4,
    });
    const itemId = added.ok ? added.data.itemId : '';
    expect(await setCartItemQuantity(db, { cartId: cart.id, itemId, quantity: 9 })).toMatchObject({
      ok: true,
      data: { quantity: 5, capped: true },
    });

    await setAvailable(variants.edt100, 2);
    const view = await getCartView(db, { cart, locale: 'vi' });
    expect(view.lines[0]).toMatchObject({
      quantity: 5,
      maxQuantity: 2,
      issues: { overStock: true, unavailable: false },
    });
    expect(view.canCheckout).toBe(false);

    expect(await setCartItemQuantity(db, { cartId: cart.id, itemId, quantity: 0 })).toMatchObject({
      ok: true,
      data: { quantity: 0 },
    });
    expect(await items(cart.id)).toEqual({});
  });

  it('flags a price changed since the line was added', async () => {
    const { cart } = await guestCart();
    await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 });
    await db
      .update(productVariants)
      .set({ price: 2_100_000 })
      .where(eq(productVariants.id, variants.edt50));
    try {
      const view = await getCartView(db, { cart, locale: 'en' });
      expect(view.lines[0]).toMatchObject({
        unitPrice: 2_100_000,
        priceWhenAdded: 2_300_000,
        issues: { priceChanged: true },
      });
      expect(view.subtotal).toBe(2_100_000);
    } finally {
      await db
        .update(productVariants)
        .set({ price: 2_300_000 })
        .where(eq(productVariants.id, variants.edt50));
    }
  });
});

describe('ownership', () => {
  it('never lets cart A change an item of cart B', async () => {
    const a = await guestCart();
    const b = await guestCart();
    const bItem = await addCartItem(db, {
      cartId: b.cart.id,
      variantId: variants.edt100,
      quantity: 1,
    });
    const itemId = bItem.ok ? bItem.data.itemId : '';

    expect(await removeCartItem(db, { cartId: a.cart.id, itemId })).toEqual({
      ok: false,
      reason: 'notFound',
    });
    expect(await setCartItemQuantity(db, { cartId: a.cart.id, itemId, quantity: 3 })).toEqual({
      ok: false,
      reason: 'notFound',
    });
    expect(await items(b.cart.id)).toEqual({ [variants.edt100]: 1 });
    // Each token only resolves its own cart.
    expect((await findActiveCart(db, { token: a.token }))?.id).toBe(a.cart.id);
    expect((await findActiveCart(db, { token: b.token }))?.id).toBe(b.cart.id);
  });
});

describe('coupons', () => {
  it('applies WELCOME10 case-insensitively and computes the discount', async () => {
    const { cart } = await guestCart();
    await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 });
    expect(
      await applyCartCoupon(db, { cartId: cart.id, code: ' welcome10 ', locale: 'vi' }),
    ).toEqual({ ok: true, data: { code: 'WELCOME10' } });
    const [row] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(row!.couponCode).toBe('WELCOME10');
    const view = await getCartView(db, { cart: row!, locale: 'vi' });
    expect(view).toMatchObject({
      subtotal: 2_300_000,
      discountTotal: 200_000,
      total: 2_100_000,
      coupon: { code: 'WELCOME10', applied: true },
    });

    await removeCartCoupon(db, { cartId: cart.id });
    const [cleared] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(cleared!.couponCode).toBeNull();
  });

  it('explains why a code is refused and does not store it', async () => {
    const { cart } = await guestCart();
    expect(await applyCartCoupon(db, { cartId: cart.id, code: 'WELCOME10', locale: 'vi' })).toEqual(
      { ok: false, reason: 'coupon', coupon: { reason: 'empty_cart' } },
    );
    await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 });
    expect(await applyCartCoupon(db, { cartId: cart.id, code: 'NOPE', locale: 'vi' })).toEqual({
      ok: false,
      reason: 'coupon',
      coupon: { reason: 'not_found' },
    });

    await db.insert(coupons).values({
      code: 'BIGSPEND',
      type: 'fixed',
      value: 300_000,
      minSubtotal: 3_000_000,
    });
    expect(await applyCartCoupon(db, { cartId: cart.id, code: 'bigspend', locale: 'vi' })).toEqual({
      ok: false,
      reason: 'coupon',
      coupon: { reason: 'min_subtotal', minSubtotal: 3_000_000, missing: 700_000 },
    });
    await db.insert(coupons).values({
      code: 'OLDCODE',
      type: 'percent',
      value: 5,
      endsAt: new Date(Date.now() - 86_400_000),
    });
    expect(await applyCartCoupon(db, { cartId: cart.id, code: 'OLDCODE', locale: 'vi' })).toEqual({
      ok: false,
      reason: 'coupon',
      coupon: { reason: 'expired' },
    });
    const [row] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(row!.couponCode).toBeNull();
  });

  it('checks the per-customer limit for members', async () => {
    const userId = (
      await db
        .insert(users)
        .values({ name: 'Member', email: `used-${Date.now()}@example.com` })
        .returning({ id: users.id })
    )[0]!.id;
    const [order] = await db
      .insert(orders)
      .values({
        code: generateOrderCode(),
        userId,
        email: 'member@example.com',
        phone: '0912345678',
        customerName: 'Member',
        locale: 'vi',
        status: 'pending',
        paymentMethod: 'vnpay',
        subtotal: 1,
        total: 1,
      })
      .returning();
    const [welcome] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME10'));
    await db.insert(couponRedemptions).values({
      couponId: welcome!.id,
      orderId: order!.id,
      userId,
      phone: '0912345678',
      email: 'member@example.com',
      amount: 1,
    });
    const { cart } = await getOrCreateCart(db, { userId }, 'vi');
    await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 });
    expect(
      await applyCartCoupon(db, { cartId: cart.id, code: 'WELCOME10', userId, locale: 'vi' }),
    ).toEqual({ ok: false, reason: 'coupon', coupon: { reason: 'per_customer_limit' } });
  });
});

describe('gift options', () => {
  it('stores wrap, a normalised message and hide-prices, and adds the wrap fee', async () => {
    const { cart } = await guestCart();
    await addCartItem(db, { cartId: cart.id, variantId: variants.edt50, quantity: 1 });
    await setGiftOptions(db, {
      cartId: cart.id,
      giftWrap: true,
      giftMessage: '  Chúc mừng sinh nhật!  ',
      hidePrices: true,
    });
    const [row] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(row).toMatchObject({
      giftWrap: true,
      giftMessage: 'Chúc mừng sinh nhật!',
      hidePrices: true,
    });
    const view = await getCartView(db, { cart: row!, locale: 'vi' });
    expect(view).toMatchObject({ giftWrapFee: 50_000, total: 2_350_000 });
    expect(view.gift).toEqual({
      wrap: true,
      message: 'Chúc mừng sinh nhật!',
      hidePrices: true,
      fee: 50_000,
    });
  });
});

/** Minimal cookie jar talking to Better Auth like a browser. */
class Browser {
  cookies = new Map<string, string>();

  async post(path: string, body: unknown): Promise<Response> {
    const response = await auth.handler(
      new Request(`${APP_URL}/api/auth${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          origin: APP_URL,
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        },
      }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (/max-age=0/i.test(header) || value === '') this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    return response;
  }
}

async function createCustomer(email: string): Promise<string> {
  const response = await new Browser().post('/sign-up/email', {
    email,
    password: PASSWORD,
    name: 'Customer',
  });
  expect(response.status).toBe(200);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, user!.id));
  return user!.id;
}

async function signInWithCart(email: string, token: string) {
  const browser = new Browser();
  browser.cookies.set(CART_COOKIE, token);
  const response = await browser.post('/sign-in/email', { email, password: PASSWORD });
  expect(response.status).toBe(200);
}

describe('merge on sign-in', () => {
  it('adopts the guest cart when the member has none', async () => {
    const email = `adopt-${Date.now()}@example.com`;
    const userId = await createCustomer(email);
    await db.delete(carts).where(eq(carts.userId, userId));
    const guest = await guestCart();
    await addCartItem(db, { cartId: guest.cart.id, variantId: variants.edt50, quantity: 2 });

    await signInWithCart(email, guest.token);

    const [row] = await db.select().from(carts).where(eq(carts.id, guest.cart.id));
    expect(row).toMatchObject({ userId, tokenHash: null, status: 'active' });
    // After sign-out the old cookie no longer opens the member's cart.
    expect(await findActiveCart(db, { token: guest.token })).toBeNull();
  });

  it('sums quantities capped by stock/limit, keeps the guest coupon and converts the guest cart', async () => {
    const email = `merge-${Date.now()}@example.com`;
    const userId = await createCustomer(email);
    const { cart: member } = await getOrCreateCart(db, { userId }, 'vi');
    await addCartItem(db, { cartId: member.id, variantId: variants.edt100, quantity: 3 });
    await addCartItem(db, { cartId: member.id, variantId: variants.parfum50, quantity: 1 });

    const guest = await guestCart();
    await addCartItem(db, { cartId: guest.cart.id, variantId: variants.edt100, quantity: 4 });
    await addCartItem(db, { cartId: guest.cart.id, variantId: variants.parfum50, quantity: 2 });
    await addCartItem(db, { cartId: guest.cart.id, variantId: variants.edt50, quantity: 1 });
    await applyCartCoupon(db, { cartId: guest.cart.id, code: 'WELCOME10', locale: 'vi' });
    await setGiftOptions(db, {
      cartId: guest.cart.id,
      giftWrap: true,
      giftMessage: 'Tặng mẹ',
      hidePrices: false,
    });
    await setAvailable(variants.parfum50, 2);

    await signInWithCart(email, guest.token);

    expect(await items(member.id)).toEqual({
      [variants.edt100]: 5, // 3 + 4, per-line limit 5
      [variants.parfum50]: 2, // 1 + 2, only 2 in stock
      [variants.edt50]: 1,
    });
    const [memberRow] = await db.select().from(carts).where(eq(carts.id, member.id));
    expect(memberRow).toMatchObject({
      couponCode: 'WELCOME10',
      giftWrap: true,
      giftMessage: 'Tặng mẹ',
      status: 'active',
    });
    const [guestRow] = await db.select().from(carts).where(eq(carts.id, guest.cart.id));
    expect(guestRow!.status).toBe('converted');

    // Idempotent: a second merge with the same token changes nothing.
    expect(await mergeGuestCart(db, { userId, guestToken: guest.token })).toEqual({
      merged: false,
      cartId: null,
    });
    const active = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(carts)
      .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
    expect(active[0]!.n).toBe(1);
  });

  it('creates a single member cart even when two requests race', async () => {
    const userId = (
      await db
        .insert(users)
        .values({ name: 'Racer', email: `race-${Date.now()}@example.com` })
        .returning({ id: users.id })
    )[0]!.id;
    const [a, b] = await Promise.all([
      getOrCreateCart(db, { userId }, 'vi'),
      getOrCreateCart(db, { userId }, 'en'),
    ]);
    expect(a.cart.id).toBe(b.cart.id);
  });
});
