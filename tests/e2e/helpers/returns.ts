import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Client } from 'pg';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';

/** Local private storage of the E2E server (playwright.config.ts `MEDIA_LOCAL_DIR`). */
export const E2E_MEDIA_DIR = process.env.MEDIA_LOCAL_DIR ?? resolve('.data/e2e-media');

/** A small real PNG for upload tests (re-encoded by the server). */
export function testPhoto(width = 320, height = 240): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 196, g: 160, b: 112 } },
  })
    .png()
    .toBuffer();
}

/*
 * Fixtures for the return specs (ADR-0017), inserted straight into the app database: a
 * delivered order (delivery belongs to other flows) with one line of 2 units, optionally with
 * an issued sandbox e-invoice, and — for the admin spec — an open return request as the
 * storefront writes it. The orders hold no stock reservation, so receiving a return never
 * changes the seed's stock. Customer names start with "E2E Return"; `deleteReturnOrders`
 * removes the orders (items, events, refunds, payments cascade) and their jobs.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for return E2E tests');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

function orderCode(): string {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const date = now.toISOString().slice(2, 10).replaceAll('-', '');
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PF-${date}-${suffix}`;
}

export type ReturnOrder = {
  id: string;
  code: string;
  itemId: string;
  productName: string;
  unitPrice: number;
  total: number;
};

export async function insertReturnOrder(input: {
  locale: 'vi' | 'en';
  email: string;
  userEmail?: string;
  /** Issued sandbox e-invoice (admin spec). */
  einvoice?: boolean;
  /** Cash on delivery the carrier has not remitted yet (nothing paid). */
  cod?: boolean;
  /** Delivered this many days ago (default 1, inside the 7-day window). */
  deliveredDaysAgo?: number;
}): Promise<ReturnOrder> {
  return withDb(async (db) => {
    const user = input.userEmail
      ? (await db.query<{ id: string }>('select id from users where email = $1', [input.userEmail]))
          .rows[0]
      : undefined;
    const variant = (
      await db.query<{ id: string; product_id: string; sku: string; price: string; name: string }>(
        `select v.id, v.product_id, v.sku, v.price, t.name
           from product_variants v
           join products p on p.id = v.product_id and p.status = 'active' and p.deleted_at is null
           join product_translations t on t.product_id = p.id and t.locale = $1
          where v.is_active and v.variant_type <> 'decant'
          order by v.sku limit 1`,
        [input.locale],
      )
    ).rows[0];
    if (!variant) throw new Error('No active variant: run pnpm db:seed');
    const id = uuidv7();
    const itemId = uuidv7();
    const code = orderCode();
    const unitPrice = Number(variant.price);
    const total = unitPrice * 2 + 30_000;
    const phone = `09${String(randomInt(10_000_000, 99_999_999))}`;
    await db.query('begin');
    try {
      await db.query(
        `insert into orders (id, code, user_id, email, phone, customer_name, locale, status,
           payment_method, payment_status, subtotal, shipping_fee, total, amount_paid,
           confirmed_at, shipped_at, delivered_at, einvoice_ref, einvoice_issued_at)
         values ($1, $2, $3, $4, $5, 'E2E Return Hương', $6, 'delivered', $10, $11, $7,
           30000, $8, $12, now() - interval '3 days', now() - interval '2 days',
           now() - make_interval(days => $13::int), $9,
           case when $9::text is null then null else now() end)`,
        [
          id,
          code,
          user?.id ?? null,
          input.email,
          phone,
          input.locale,
          unitPrice * 2,
          total,
          input.einvoice ? `C26SBX-E2E${code.slice(-4)}` : null,
          input.cod ? 'cod' : 'vnpay',
          input.cod ? 'unpaid' : 'paid',
          input.cod ? 0 : total,
          input.deliveredDaysAgo ?? 1,
        ],
      );
      await db.query(
        `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
           sku, unit_price, quantity, line_total)
         values ($1, $2, $3, $4, $5, '100 ml', $6, $7, 2, $8)`,
        [
          itemId,
          id,
          variant.product_id,
          variant.id,
          variant.name,
          variant.sku,
          unitPrice,
          unitPrice * 2,
        ],
      );
      await db.query(
        `insert into order_addresses (order_id, type, full_name, phone, province_code, province_name,
           ward_code, ward_name, street)
         values ($1, 'shipping', 'E2E Return Hương', $2, '79', 'Thành phố Hồ Chí Minh', '26743',
           'Phường Bến Thành', '12 Lê Lợi')`,
        [id, phone],
      );
      if (!input.cod) {
        await db.query(
          `insert into payments (id, order_id, provider, kind, amount, status, txn_ref, paid_at)
           values ($1, $2, 'vnpay', 'full', $3, 'succeeded', $4, now() - interval '3 days')`,
          [uuidv7(), id, total, `${Date.now()}${randomInt(1000, 9999)}`.slice(-16)],
        );
      }
      for (const [from, to, ago] of [
        [null, 'pending', '4 days'],
        ['pending', 'confirmed', '3 days'],
        ['confirmed', 'processing', '3 days'],
        ['processing', 'shipped', '2 days'],
        ['shipped', 'delivered', '1 day'],
      ] as const) {
        await db.query(
          `insert into order_events (id, order_id, type, from_status, to_status, actor_type, created_at)
           values ($1, $2, 'status_changed', $3, $4, 'system', now() - $5::interval)`,
          [uuidv7(), id, from, to, ago],
        );
      }
      if (input.einvoice) {
        await db.query(
          `insert into order_events (id, order_id, type, actor_type, metadata)
           values ($1, $2, 'einvoice_issued', 'system', $3)`,
          [
            uuidv7(),
            id,
            {
              ref: `C26SBX-E2E${code.slice(-4)}`,
              provider: 'sandbox',
              invoiceNo: `E2E${code.slice(-4)}`,
              series: 'C26SBX',
              templateCode: '1',
              transactionId: `SBX-${id}`,
              lookupCode: `E2E${code.slice(-4)}`,
              issuedAt: new Date().toISOString(),
              buyer: 'individual',
              attempt: 1,
            },
          ],
        );
      }
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    return { id, code, itemId, productName: variant.name, unitPrice, total };
  });
}

/**
 * An open return request, as the storefront form writes it (admin spec), optionally with one
 * photo stored like the upload route does (`private/returns/<order>/<photo>.webp`).
 */
export async function insertReturnRequest(
  order: ReturnOrder,
  input: {
    reason: 'defective' | 'unopened';
    quantity: number;
    description: string;
    photo?: boolean;
  },
): Promise<string> {
  const requestId = uuidv7();
  const photos: Array<{
    id: string;
    key: string;
    mime: string;
    width: number;
    height: number;
    sizeBytes: number;
  }> = [];
  if (input.photo) {
    const photoId = uuidv7();
    const key = `private/returns/${order.id}/${photoId}.webp`;
    const body = await sharp(await testPhoto())
      .webp()
      .toBuffer();
    const path = join(E2E_MEDIA_DIR, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    photos.push({
      id: photoId,
      key,
      mime: 'image/webp',
      width: 320,
      height: 240,
      sizeBytes: body.length,
    });
  }
  await withDb(async (db) => {
    await db.query(
      `update orders set status = 'return_requested', version = version + 1 where id = $1`,
      [order.id],
    );
    await db.query(
      `insert into order_events (id, order_id, type, from_status, to_status, message, actor_type, metadata)
       values ($1, $2, 'status_changed', 'delivered', 'return_requested', $3, 'customer', $4)`,
      [uuidv7(), order.id, input.reason, { requestId }],
    );
    await db.query(
      `insert into order_events (id, order_id, type, message, actor_type, metadata)
       values ($1, $2, 'return_requested', $3, 'customer', $4)`,
      [
        uuidv7(),
        order.id,
        input.description,
        {
          requestId,
          reason: input.reason,
          resolution: 'refund',
          lines: [{ orderItemId: order.itemId, quantity: input.quantity }],
          sealIntact: input.reason === 'unopened',
          photos,
        },
      ],
    );
  });
  return requestId;
}

export async function orderState(orderId: string) {
  return withDb(async (db) => {
    const order = (
      await db.query<{ status: string; einvoice_ref: string | null }>(
        'select status, einvoice_ref from orders where id = $1',
        [orderId],
      )
    ).rows[0];
    const events = (
      await db.query<{ type: string; message: string | null; metadata: Record<string, unknown> }>(
        `select type, message, metadata from order_events where order_id = $1 order by created_at, id`,
        [orderId],
      )
    ).rows;
    const refunds = (
      await db.query<{ amount: string; status: string; method: string; reason: string }>(
        'select amount, status, method, reason from refunds where order_id = $1 order by amount desc',
        [orderId],
      )
    ).rows.map((row) => ({
      amount: Number(row.amount),
      status: row.status,
      method: row.method,
      reason: row.reason,
    }));
    const jobs = (
      await db
        .query<{ name: string; data: Record<string, unknown> }>(
          `select name, data from pgboss.job where data->>'orderId' = $1 order by created_on`,
          [orderId],
        )
        .catch(() => ({ rows: [] }))
    ).rows;
    return { ...order!, events, refunds, jobs };
  });
}

export async function deleteReturnOrders(ids: readonly string[]): Promise<void> {
  if (ids.length === 0 || !process.env.DATABASE_URL) return;
  await withDb(async (db) => {
    await db
      .query(`delete from pgboss.job where data->>'orderId' = any($1)`, [ids])
      .catch(() => undefined);
    await db.query('delete from notification_logs where ref_id = any($1::text[])', [ids]);
    await db.query(
      `delete from cod_remittances where id in
         (select remittance_id from cod_remittance_orders where order_id = any($1::uuid[]))`,
      [ids],
    );
    await db.query('delete from orders where id = any($1::uuid[])', [ids]);
  });
}
