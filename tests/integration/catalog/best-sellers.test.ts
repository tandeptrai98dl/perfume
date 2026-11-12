import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { orderItems, orders, productTranslations, productVariants } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { getProductListing, getProductSummariesByIds } from '@/server/modules/catalog';
import { bestSellerWindowStart, listBestSellingProductIds } from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertOrder } from '../helpers/orders';

/*
 * Best sellers (§2 Discovery): units sold in paid / delivered orders of the window, ranked by
 * the order module; the catalogue applies visibility (ADR-0021) and the "best selling" sort.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

const SLUG = {
  edt: 'maison-lumiere-cedre-nocturne-edt',
  hoaDem: 'atelier-suong-hoa-dem-edp', // no published English translation
  soleil: 'ambre-studio-soleil-ambre-parfum',
};

async function productId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: productTranslations.productId })
    .from(productTranslations)
    .where(and(eq(productTranslations.locale, 'vi'), eq(productTranslations.slug, slug)));
  return row!.id;
}

/** An order of `quantity` units of the product's first variant, with the given states. */
async function sell(
  slug: string,
  quantity: number,
  state: {
    status:
      'confirmed' | 'delivered' | 'completed' | 'cancelled' | 'returned' | 'awaiting_confirmation';
    paymentStatus?: 'unpaid' | 'paid' | 'partially_refunded';
    placedAt?: Date;
  },
) {
  const id = await productId(slug);
  const [variant] = await db
    .select({ id: productVariants.id, sku: productVariants.sku })
    .from(productVariants)
    .where(eq(productVariants.productId, id))
    .limit(1);
  const order = await insertOrder(db, { status: state.status, total: 1_000_000 * quantity });
  await db
    .update(orders)
    .set({
      paymentStatus: state.paymentStatus ?? 'unpaid',
      ...(state.placedAt ? { placedAt: state.placedAt } : {}),
    })
    .where(eq(orders.id, order.id));
  await db
    .update(orderItems)
    .set({ productId: id, variantId: variant!.id, sku: variant!.sku, quantity })
    .where(eq(orderItems.orderId, order.id));
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('listBestSellingProductIds', () => {
  it('is empty before the first counted sale', async () => {
    await sell(SLUG.soleil, 9, { status: 'awaiting_confirmation' }); // unconfirmed COD
    await sell(SLUG.soleil, 9, { status: 'confirmed' }); // confirmed, unpaid COD
    const since = bestSellerWindowStart(new Date());
    expect(await listBestSellingProductIds(db, { since })).toEqual([]);
  });

  it('ranks paid and delivered orders by units; cancelled, returned and old orders do not count', async () => {
    await sell(SLUG.edt, 2, { status: 'confirmed', paymentStatus: 'paid' });
    await sell(SLUG.edt, 1, { status: 'completed', paymentStatus: 'partially_refunded' });
    await sell(SLUG.hoaDem, 4, { status: 'delivered' }); // COD delivered
    await sell(SLUG.soleil, 50, { status: 'cancelled', paymentStatus: 'paid' });
    await sell(SLUG.soleil, 50, { status: 'returned' });
    await sell(SLUG.soleil, 50, {
      status: 'completed',
      paymentStatus: 'paid',
      placedAt: new Date(Date.now() - 200 * 24 * 3600_000),
    });

    const ranked = await listBestSellingProductIds(db, {
      since: bestSellerWindowStart(new Date()),
    });
    expect(ranked).toEqual([await productId(SLUG.hoaDem), await productId(SLUG.edt)]);
  });

  it('feeds the "best selling" sort and keeps English visibility rules', async () => {
    const ranked = await listBestSellingProductIds(db, {
      since: bestSellerWindowStart(new Date()),
    });

    const vi = await getProductListing({ locale: 'vi', sort: 'best_selling' }, db, {
      salesRank: ranked,
    });
    expect(vi.items.slice(0, 2).map((item) => item.slug)).toEqual([SLUG.hoaDem, SLUG.edt]);
    // Unranked products follow in featured order: every visible product is still listed.
    const featured = await getProductListing({ locale: 'vi', sort: 'featured' }, db);
    expect(vi.total).toBe(featured.total);

    // The best seller has no published English translation: it is skipped under /en.
    const en = await getProductListing({ locale: 'en', sort: 'best_selling' }, db, {
      salesRank: ranked,
    });
    expect(en.items[0]!.slug).toBe(SLUG.edt);
    expect((await getProductSummariesByIds('en', ranked, db)).map((item) => item.slug)).toEqual([
      SLUG.edt,
    ]);
  });

  it('without a ranking the sort equals the featured order', async () => {
    const plain = await getProductListing({ locale: 'vi', sort: 'best_selling' }, db);
    const featured = await getProductListing({ locale: 'vi', sort: 'featured' }, db);
    expect(plain.items.map((item) => item.id)).toEqual(featured.items.map((item) => item.id));
    const count = await db.execute<{ n: number }>(sql`select count(*)::int as n from orders`);
    expect(count.rows[0]!.n).toBeGreaterThan(0);
  });
});
