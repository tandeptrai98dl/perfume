import { randomInt } from 'node:crypto';

import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

/*
 * Orders for admin E2E runs, inserted straight into the app database (placeOrder belongs to the
 * checkout stream). They hold no stock reservation, so confirming them never changes the seed's
 * stock, and `deleteE2EOrders` removes them (items, events, shipments cascade) afterwards.
 * Customer names start with "E2E Admin" so storefront tests can ignore them.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export type E2EOrder = { id: string; code: string };

export type E2EOrderInput = {
  status?: 'awaiting_confirmation' | 'confirmed' | 'processing';
  customerName: string;
  phone?: string;
  depositRequired?: number;
  hidePrices?: boolean;
  giftMessage?: string;
};

function orderCode(): string {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const date = now.toISOString().slice(2, 10).replaceAll('-', '');
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PF-${date}-${suffix}`;
}

async function withClient<T>(
  fn: (db: Client) => Promise<T>,
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for admin E2E tests');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function createE2EOrder(input: E2EOrderInput): Promise<E2EOrder> {
  return withClient(async (db) => {
    const variant = await db.query<{
      id: string;
      product_id: string;
      sku: string;
      price: string;
      name: string;
    }>(
      `select v.id, v.product_id, v.sku, v.price, coalesce(t.name, v.sku) as name
         from product_variants v
         join products p on p.id = v.product_id and p.status = 'active' and p.deleted_at is null
         left join product_translations t on t.product_id = p.id and t.locale = 'vi'
        where v.is_active order by v.sku limit 1`,
    );
    const line = variant.rows[0];
    if (!line) throw new Error('No active variant: run pnpm db:seed');
    const id = uuidv7();
    const code = orderCode();
    const price = Number(line.price);
    const phone = input.phone ?? `09${String(randomInt(10_000_000, 99_999_999))}`;
    const status = input.status ?? 'awaiting_confirmation';
    await db.query('begin');
    try {
      await db.query(
        `insert into orders (id, code, email, phone, customer_name, locale, status, payment_method,
           subtotal, shipping_fee, total, deposit_required, hide_prices, gift_wrap, gift_message,
           confirmed_at)
         values ($1, $2, $3, $4, $5, 'vi', $6::order_status, 'cod', $7, 30000, $8, $9, $10, $11, $12,
           case when $6::text = 'awaiting_confirmation' then null else now() end)`,
        [
          id,
          code,
          `e2e-admin-${code.toLowerCase()}@perfume.test`,
          phone,
          input.customerName,
          status,
          price,
          price + 30_000,
          input.depositRequired ?? 0,
          input.hidePrices ?? false,
          !!input.giftMessage,
          input.giftMessage ?? null,
        ],
      );
      await db.query(
        `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
           sku, unit_price, quantity, line_total)
         values ($1, $2, $3, $4, $5, '100ml', $6, $7, 1, $7)`,
        [uuidv7(), id, line.product_id, line.id, line.name, line.sku, price],
      );
      await db.query(
        `insert into order_addresses (order_id, type, full_name, phone, province_code, province_name,
           ward_code, ward_name, street)
         values ($1, 'shipping', $2, $3, '79', 'Thành phố Hồ Chí Minh', '26734', 'Phường Bến Thành',
           '12 Lê Lợi')`,
        [id, input.customerName, phone],
      );
      await db.query(
        `insert into order_events (id, order_id, type, to_status, actor_type)
         values ($1, $2, 'status_changed', $3, 'customer')`,
        [uuidv7(), id, status],
      );
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    return { id, code };
  });
}

export async function deleteE2EOrders(orders: readonly E2EOrder[]): Promise<void> {
  if (orders.length === 0 || !process.env.DATABASE_URL) return;
  await withClient(async (db) => {
    await db.query('delete from orders where id = any($1::uuid[])', [orders.map((o) => o.id)]);
  });
}

/** Removes coupons and shipping zones an admin E2E run created (by unique name prefix). */
export async function deleteE2EPromotions(prefix: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await withClient(async (db) => {
    await db.query(
      'delete from coupons where code ilike $1 and id not in (select coupon_id from coupon_redemptions)',
      [`${prefix}%`],
    );
    await db.query('delete from shipping_zones where name like $1', [`${prefix}%`]);
  });
}
