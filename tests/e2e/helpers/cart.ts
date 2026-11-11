import { createHash, randomBytes } from 'node:crypto';

import type { BrowserContext } from '@playwright/test';
import { Client } from 'pg';

/*
 * Test carts written straight into the cart tables (the cart UI is another stream), and the
 * `cart_token` cookie that makes the browser their owner. Orders placed by a test are removed
 * afterwards, releasing their reservations, so stock on the demo seed stays stable.
 */

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for checkout E2E tests');
  return url;
}

export async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function seedCart(
  baseURL: string,
  context: BrowserContext,
  lines: { sku: string; quantity: number }[],
  options: { locale?: 'vi' | 'en'; giftWrap?: boolean } = {},
): Promise<{ cartId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const cartId = await withDb(async (client) => {
    const id = crypto.randomUUID();
    await client.query(
      `insert into carts (id, token_hash, locale, gift_wrap, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 day')`,
      [id, tokenHash, options.locale ?? 'vi', options.giftWrap ?? false],
    );
    for (const line of lines) {
      await client.query(
        `insert into cart_items (id, cart_id, variant_id, quantity, price_when_added)
         select $1, $2, v.id, $3, v.price from product_variants v where v.sku = $4`,
        [crypto.randomUUID(), id, line.quantity, line.sku],
      );
    }
    return id;
  });
  await context.addCookies([
    { name: 'cart_token', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' },
  ]);
  return { cartId, token };
}

export type PlacedOrderRow = {
  id: string;
  code: string;
  status: string;
  payment_method: string;
  locale: string;
  total: string;
  deposit_required: string;
  email: string;
};

export async function findOrder(code: string): Promise<PlacedOrderRow | null> {
  return withDb(async (client) => {
    const result = await client.query<PlacedOrderRow>(
      `select id, code, status, payment_method, locale, total, deposit_required, email
       from orders where code = $1`,
      [code],
    );
    return result.rows[0] ?? null;
  });
}

/** Removes every order placed with this (per-test) email, e.g. after a failed assertion. */
export async function removeOrdersByEmail(email: string): Promise<void> {
  const codes = await withDb(async (client) => {
    const result = await client.query<{ code: string }>(
      'select code from orders where email = $1',
      [email],
    );
    return result.rows.map((row) => row.code);
  });
  for (const code of codes) await removeOrder(code);
  await withDb((client) => client.query('delete from consents where email = $1', [email]));
}

/** Releases the order's reservations and deletes it (cascades to items, events, …). */
export async function removeOrder(code: string): Promise<void> {
  await withDb(async (client) => {
    await client.query('begin');
    try {
      await client.query(
        `update inventory_items i set reserved = i.reserved - r.quantity
         from stock_reservations r join orders o on o.id = r.order_id
         where o.code = $1 and r.status = 'active'
           and i.variant_id = r.variant_id and i.location_id = r.location_id`,
        [code],
      );
      await client.query(
        `delete from coupon_redemptions where order_id in (select id from orders where code = $1)`,
        [code],
      );
      await client.query(`delete from orders where code = $1`, [code]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

export async function removeCart(cartId: string): Promise<void> {
  await withDb((client) => client.query('delete from carts where id = $1', [cartId]));
}
