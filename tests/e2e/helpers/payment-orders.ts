import { createHmac, randomInt } from 'node:crypto';

import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

/*
 * Test orders written straight to the app database (the checkout UI belongs to another
 * stream): order + item + address + stock reservation, as `placeOrder` creates them.
 * `cleanupOrders` removes them again and gives the stock back, so runs never drain the seed.
 */

const DEV_AUTH_SECRET = 'dev-only-insecure-better-auth-secret-change-me';
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Public simulator keys (src/server/integrations/payments/index.ts). */
export const SIMULATOR = {
  payosChecksumKey: 'dev-only-payos-checksum-key-not-for-production',
};

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for payment E2E tests');
  return url;
}

export async function withDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Same token as `orderAccessToken` (src/server/order-access.ts). */
export function accessToken(code: string): string {
  return createHmac('sha256', process.env.BETTER_AUTH_SECRET || DEV_AUTH_SECRET)
    .update(`order-access:${code}`)
    .digest('base64url')
    .slice(0, 32);
}

function orderCode(): string {
  const vn = new Date(Date.now() + 7 * 3_600_000);
  const date = vn.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PF-${date}-${suffix}`;
}

export type TestOrder = { id: string; code: string; token: string; total: number };

export type TestOrderOptions = {
  method: 'payos' | 'vnpay' | 'cod';
  status?: string;
  paymentStatus?: string;
  total?: number;
  deposit?: number;
  amountPaid?: number;
  /** Minutes the stock stays reserved; omit for orders that hold no reservation. */
  reservationMinutes?: number | null;
  locale?: 'vi' | 'en';
  deliveredAt?: Date | null;
};

export async function createTestOrder(options: TestOrderOptions): Promise<TestOrder> {
  const total = options.total ?? 1_450_000;
  const code = orderCode();
  const id = uuidv7();
  await withDb(async (db) => {
    const { rows } = await db.query<{
      variant_id: string;
      product_id: string;
      location_id: string;
    }>(
      `select i.variant_id, v.product_id, i.location_id
       from inventory_items i
       join product_variants v on v.id = i.variant_id
       join products p on p.id = v.product_id
       where p.status = 'active' and v.is_active and i.on_hand - i.reserved > 2
       order by i.on_hand - i.reserved desc limit 1`,
    );
    const line = rows[0];
    if (!line) throw new Error('No variant in stock for payment E2E tests');
    await db.query('begin');
    await db.query(
      `insert into orders (id, code, email, phone, customer_name, locale, status, payment_status,
         payment_method, subtotal, shipping_fee, total, deposit_required, amount_paid, delivered_at)
       values ($1, $2, 'e2e@perfume.test', '0912345678', 'Khách E2E', $3, $4, $5, $6, $7, 0, $7, $8, $9, $10)`,
      [
        id,
        code,
        options.locale ?? 'vi',
        options.status ??
          (options.method === 'cod' && !options.deposit ? 'awaiting_confirmation' : 'pending'),
        options.paymentStatus ?? 'unpaid',
        options.method,
        total,
        options.deposit ?? 0,
        options.amountPaid ?? 0,
        options.deliveredAt ?? null,
      ],
    );
    await db.query(
      `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
         sku, unit_price, quantity, line_total)
       values ($1, $2, $3, $4, 'Eau de Parfum E2E', '100 ml', 'E2E-SKU', $5, 1, $5)`,
      [uuidv7(), id, line.product_id, line.variant_id, total],
    );
    await db.query(
      `insert into order_addresses (order_id, type, full_name, phone, province_code, province_name,
         ward_code, ward_name, street)
       values ($1, 'shipping', 'Khách E2E', '0912345678', '79', 'TP. Hồ Chí Minh', '26743',
         'Phường Bến Nghé', '1 Lê Lợi')`,
      [id],
    );
    if (options.reservationMinutes !== null && options.reservationMinutes !== undefined) {
      await db.query(
        `update inventory_items set reserved = reserved + 1 where variant_id = $1 and location_id = $2`,
        [line.variant_id, line.location_id],
      );
      await db.query(
        `insert into stock_reservations (id, order_id, variant_id, location_id, quantity, expires_at)
         values ($1, $2, $3, $4, 1, now() + make_interval(mins => $5))`,
        [uuidv7(), id, line.variant_id, line.location_id, options.reservationMinutes],
      );
    }
    await db.query('commit');
  });
  return { id, code, token: accessToken(code), total };
}

/** Deletes test orders and returns their stock (active → unreserve, committed → restock). */
export async function cleanupOrders(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDb(async (db) => {
    await db.query('begin');
    // Aggregate first: UPDATE … FROM applies only one joined row per target row.
    for (const [status, column] of [
      ['active', 'reserved = i.reserved - s.qty'],
      ['committed', 'on_hand = i.on_hand + s.qty'],
    ] as const) {
      await db.query(
        `update inventory_items i set ${column}
         from (select variant_id, location_id, sum(quantity)::int as qty from stock_reservations
               where order_id = any($1) and status = $2 group by variant_id, location_id) s
         where i.variant_id = s.variant_id and i.location_id = s.location_id`,
        [ids, status],
      );
    }
    await db.query(`delete from stock_movements where ref_type = 'order' and ref_id = any($1)`, [
      ids,
    ]);
    await db.query(
      `delete from payment_events where payment_id in (select id from payments where order_id = any($1))`,
      [ids],
    );
    await db.query(`delete from cod_remittance_orders where order_id = any($1)`, [ids]);
    await db.query(`delete from orders where id = any($1)`, [ids]);
    await db.query('commit');
  });
}

export async function latestPayment(orderId: string) {
  return withDb(async (db) => {
    const { rows } = await db.query<{
      txn_ref: string;
      amount: string;
      provider: string;
      status: string;
    }>(
      `select txn_ref, amount, provider, status from payments where order_id = $1
       order by created_at desc limit 1`,
      [orderId],
    );
    return rows[0] ? { ...rows[0], amount: Number(rows[0].amount) } : null;
  });
}

export async function orderState(orderId: string) {
  return withDb(async (db) => {
    const { rows } = await db.query<{
      status: string;
      payment_status: string;
      amount_paid: string;
    }>('select status, payment_status, amount_paid from orders where id = $1', [orderId]);
    return rows[0]!;
  });
}

/** A payOS webhook body signed like payOS does (HMAC-SHA256 over sorted `data`). */
export function signedPayosWebhook(txnRef: string, amount: number) {
  const data: Record<string, string | number> = {
    accountNumber: '0000000000',
    amount,
    code: '00',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: '',
    counterAccountNumber: '',
    currency: 'VND',
    desc: 'success',
    description: 'E2E',
    orderCode: Number(txnRef),
    paymentLinkId: 'e2e-link',
    reference: `E2E${txnRef.slice(-8)}`,
    transactionDateTime: '2026-11-11 15:31:00',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  const text = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('&');
  const signature = createHmac('sha256', SIMULATOR.payosChecksumKey).update(text).digest('hex');
  return { code: '00', desc: 'success', success: true, data, signature };
}
