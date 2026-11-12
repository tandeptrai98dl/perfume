import { createHash, randomBytes, randomInt } from 'node:crypto';

import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

/*
 * Fixtures for the review & wishlist specs, inserted straight into the app database:
 * delivered orders (placeOrder and delivery belong to other flows), guest review links with
 * a known raw token (only its SHA-256 is stored, as the app does) and pending reviews for the
 * moderation spec. Customer names start with "E2E Review"; `deleteReviewOrders` removes the
 * orders (items, reviews, invitations cascade).
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for review E2E tests');
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

export type ReviewProduct = { id: string; name: string; viSlug: string; enSlug: string };

/** A sellable seed product with both translations published (`index` picks another one). */
export async function reviewProduct(index = 0): Promise<ReviewProduct> {
  return withDb(async (db) => {
    const result = await db.query<{ id: string; name: string; vi: string; en: string }>(
      `select p.id, vi.name, vi.slug as vi, en.slug as en
       from products p
       join product_translations vi on vi.product_id = p.id and vi.locale = 'vi' and vi.is_published
       join product_translations en on en.product_id = p.id and en.locale = 'en' and en.is_published
       where p.status = 'active' and p.deleted_at is null
         and exists (select 1 from product_variants v where v.product_id = p.id and v.is_active
                     and v.variant_type <> 'decant')
       order by vi.slug
       offset $1 limit 1`,
      [index],
    );
    const row = result.rows[0];
    if (!row) throw new Error('No published product in the seed');
    return { id: row.id, name: row.name, viSlug: row.vi, enSlug: row.en };
  });
}

/** Delivered order with one line of `productId`; returns the order and line ids. */
export async function insertDeliveredOrder(input: {
  productId: string;
  locale: 'vi' | 'en';
  email: string;
  userEmail?: string;
  status?: 'delivered' | 'completed';
}): Promise<{ orderId: string; orderItemId: string; code: string }> {
  return withDb(async (db) => {
    const user = input.userEmail
      ? (await db.query<{ id: string }>('select id from users where email = $1', [input.userEmail]))
          .rows[0]
      : undefined;
    const variant = (
      await db.query<{ id: string; sku: string; price: string; size_ml: number }>(
        `select id, sku, price, size_ml from product_variants
         where product_id = $1 and is_active and variant_type <> 'decant'
         order by is_default desc, sku limit 1`,
        [input.productId],
      )
    ).rows[0]!;
    const orderId = uuidv7();
    const orderItemId = uuidv7();
    const code = orderCode();
    await db.query(
      `insert into orders (id, code, user_id, email, phone, customer_name, locale, status,
         payment_method, payment_status, subtotal, total, amount_paid, delivered_at)
       values ($1, $2, $3, $4, '0912345678', 'E2E Review Hương', $5, $6, 'vnpay', 'paid', $7, $7, $7,
         now())`,
      [
        orderId,
        code,
        user?.id ?? null,
        input.email,
        input.locale,
        input.status ?? 'delivered',
        variant.price,
      ],
    );
    await db.query(
      `insert into order_items (id, order_id, product_id, variant_id, product_name, variant_label,
         sku, unit_price, quantity, line_total)
       values ($1, $2, $3, $4, (select name from product_translations
         where product_id = $3 and locale = $7), $5, $6, $8, 1, $8)`,
      [
        orderItemId,
        orderId,
        input.productId,
        variant.id,
        `${variant.size_ml} ml`,
        variant.sku,
        input.locale,
        variant.price,
      ],
    );
    return { orderId, orderItemId, code };
  });
}

/** Guest review link for a line: returns the raw token (the e-mail would carry it). */
export async function insertInvitation(input: {
  orderItemId: string;
  email: string;
  expiresInDays?: number;
}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await withDb((db) =>
    db.query(
      `insert into review_invitations (id, order_item_id, email, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [uuidv7(), input.orderItemId, input.email, hash, input.expiresInDays ?? 30],
    ),
  );
  return token;
}

/** Pending review written for a line (moderation spec). */
export async function insertPendingReview(input: {
  orderItemId: string;
  productId: string;
  reviewerName: string;
  body: string;
  rating: number;
  locale: 'vi' | 'en';
}): Promise<string> {
  const id = uuidv7();
  await withDb((db) =>
    db.query(
      `insert into reviews (id, product_id, order_item_id, reviewer_name, locale, rating,
         longevity, title, body, status)
       values ($1, $2, $3, $4, $5, $6, 4, null, $7, 'pending')`,
      [
        id,
        input.productId,
        input.orderItemId,
        input.reviewerName,
        input.locale,
        input.rating,
        input.body,
      ],
    ),
  );
  return id;
}

export async function reviewRows(orderItemId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      status: string;
      rating: number;
      locale: string;
      user_id: string | null;
    }>('select status, rating, locale, user_id from reviews where order_item_id = $1', [
      orderItemId,
    ]);
    return result.rows;
  });
}

export async function productRating(productId: string) {
  return withDb(async (db) => {
    const result = await db.query<{ rating_avg: string; rating_count: number }>(
      'select rating_avg, rating_count from products where id = $1',
      [productId],
    );
    return { avg: Number(result.rows[0]!.rating_avg), count: result.rows[0]!.rating_count };
  });
}

/** Removes the orders (and their reviews/invitations) and the wishlist rows of `emails`. */
export async function deleteReviewOrders(orderIds: string[], emails: string[] = []) {
  await withDb(async (db) => {
    if (orderIds.length > 0) {
      await db.query('delete from orders where id = any($1::uuid[])', [orderIds]);
    }
    if (emails.length > 0) {
      await db.query(
        'delete from wishlists where user_id in (select id from users where email = any($1::text[]))',
        [emails],
      );
    }
  });
}
