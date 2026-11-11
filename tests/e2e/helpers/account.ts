import { randomBytes, randomInt } from 'node:crypto';

import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

/**
 * DB helpers for the account E2E specs: read queued auth e-mails (no SMTP in E2E: the job
 * payload holds the link) and insert orders for a customer (placeOrder belongs to checkout).
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for account E2E tests');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${randomBytes(3).toString('hex')}@perfume.test`;
}

/** A random documentation-range IP, so each test has its own rate-limit bucket. */
export function testIp(): string {
  return `198.51.100.${randomInt(1, 254)}`;
}

/** Latest queued `auth.email` link of `kind` for `to` (polls: the job is enqueued by the request). */
export async function authEmailLink(
  to: string,
  kind: 'verify_email' | 'reset_password',
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await withDb(async (db) => {
      const result = await db.query<{ url: string }>(
        `select data->>'url' as url from pgboss.job
         where name = 'auth.email' and data->>'to' = $1 and data->>'kind' = $2
         order by created_on desc limit 1`,
        [to, kind],
      );
      return result.rows[0]?.url;
    });
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${kind} e-mail queued for ${to}`);
}

function orderCode(): string {
  const now = new Date(Date.now() + 7 * 3600_000);
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PF-${date}-${suffix}`;
}

/** Inserts an order (one item, Hà Nội address) for a customer or a guest; returns its code. */
export async function insertOrder(input: {
  email: string;
  userEmail?: string;
  phone: string;
  locale: 'vi' | 'en';
  status: 'pending' | 'processing' | 'awaiting_confirmation';
}): Promise<string> {
  return withDb(async (db) => {
    const code = orderCode();
    const user = input.userEmail
      ? (await db.query<{ id: string }>('select id from users where email = $1', [input.userEmail]))
          .rows[0]
      : undefined;
    const variant = (
      await db.query<{ id: string; product_id: string; sku: string; price: string }>(
        'select id, product_id, sku, price from product_variants order by sku limit 1',
      )
    ).rows[0]!;
    const id = (
      await db.query<{ id: string }>(
        `insert into orders (id, code, user_id, email, phone, customer_name, locale, status,
           payment_method, subtotal, total)
         values ($9, $1, $2, $3, $4, 'E2E Khách', $5, $6, $7, $8, $8)
         returning id`,
        [
          code,
          user?.id ?? null,
          input.email,
          input.phone,
          input.locale,
          input.status,
          input.status === 'awaiting_confirmation' ? 'cod' : 'vnpay',
          variant.price,
          uuidv7(),
        ],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
         sku, unit_price, quantity, line_total)
       values ($6, $1, $2, $3, 'Cèdre Nocturne EDT', '100 ml', $4, $5, 1, $5)`,
      [id, variant.product_id, variant.id, variant.sku, variant.price, uuidv7()],
    );
    await db.query(
      `insert into order_addresses (order_id, type, full_name, phone, province_code, province_name,
         ward_code, ward_name, street)
       values ($1, 'shipping', 'E2E Khách', $2, '01', 'Thành phố Hà Nội', '00004', 'Phường Ba Đình',
         '12 Hàng Bạc')`,
      [id, input.phone],
    );
    return code;
  });
}

export async function userRow(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{ locale: string; phone: string | null; consents: number }>(
      `select u.locale, u.phone,
         (select count(*)::int from consents c where c.user_id = u.id and c.purpose = 'marketing_email'
            and c.granted) as consents
       from users u where u.email = $1`,
      [email],
    );
    return result.rows[0];
  });
}
