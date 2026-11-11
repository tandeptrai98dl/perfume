import { and, eq, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/server/db/client';
import { cartItems, carts } from '@/server/db/schema';
import { availableQuantitySql } from '@/server/modules/inventory';

import { hashCartToken } from './token';

/*
 * Cart read API (M2 foundation) shared by the cart UI and `placeOrder`. Prices come from the
 * catalogue at read time (never from the cart row): `priceWhenAdded` only flags changes.
 */

type Executor = Pick<Database, 'select' | 'execute'>;

export type CartRow = typeof carts.$inferSelect;

export type CartLine = {
  itemId: string;
  variantId: string;
  productId: string;
  brandId: string;
  categoryIds: string[];
  sku: string;
  sizeMl: number;
  productName: string;
  productSlug: string | null;
  brandName: string;
  imageStorageKey: string | null;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  priceWhenAdded: number;
  quantity: number;
  weightG: number;
  available: number;
  /** False when the product/variant is no longer sold (draft, archived, inactive, decant). */
  purchasable: boolean;
};

export async function findActiveCart(
  db: Pick<Database, 'select'>,
  owner: { userId?: string | null; token?: string | null },
): Promise<CartRow | null> {
  const condition = owner.userId
    ? eq(carts.userId, owner.userId)
    : owner.token
      ? eq(carts.tokenHash, hashCartToken(owner.token))
      : undefined;
  if (!condition) return null;
  const [cart] = await db
    .select()
    .from(carts)
    .where(and(condition, eq(carts.status, 'active')))
    .orderBy(sql`${carts.updatedAt} desc`)
    .limit(1);
  return cart ?? null;
}

type LineRow = {
  item_id: string;
  variant_id: string;
  product_id: string;
  brand_id: string;
  category_ids: string[] | null;
  sku: string;
  size_ml: number;
  product_name: string;
  product_slug: string | null;
  brand_name: string;
  image_storage_key: string | null;
  image_url: string | null;
  unit_price: string | number;
  compare_at_price: string | number | null;
  price_when_added: string | number;
  quantity: number;
  weight_g: number;
  available: string | number;
  purchasable: boolean;
};

/** Lines of a cart with live prices, availability and names in `locale` (Vietnamese fallback). */
export async function getCartLines(
  db: Executor,
  input: { cartId: string; locale: Locale },
): Promise<CartLine[]> {
  const result = await db.execute<LineRow>(sql`
    select ci.id as item_id, v.id as variant_id, p.id as product_id, b.id as brand_id,
      (select array_agg(pc.category_id) from product_categories pc where pc.product_id = p.id) as category_ids,
      v.sku, v.size_ml,
      coalesce(pt_loc.name, pt_vi.name) as product_name,
      coalesce(pt_loc.slug, pt_vi.slug) as product_slug,
      b.name as brand_name,
      img.storage_key as image_storage_key, img.url as image_url,
      v.price as unit_price, v.compare_at_price, ci.price_when_added, ci.quantity, v.weight_g,
      ${availableQuantitySql(sql`v.id`)} as available,
      (v.is_active and v.variant_type <> 'decant' and p.status = 'active' and p.deleted_at is null
        and b.status = 'active' and b.deleted_at is null and pt_vi.is_published) as purchasable
    from ${cartItems} ci
    join product_variants v on v.id = ci.variant_id
    join products p on p.id = v.product_id
    join brands b on b.id = p.brand_id
    left join product_translations pt_vi on pt_vi.product_id = p.id and pt_vi.locale = 'vi'
    left join product_translations pt_loc on pt_loc.product_id = p.id and pt_loc.locale = ${input.locale}
      and pt_loc.is_published
    left join lateral (
      select m.storage_key, m.url from product_media pm join media m on m.id = pm.media_id
      where pm.product_id = p.id and (pm.variant_id is null or pm.variant_id = v.id)
      order by (pm.variant_id = v.id) desc nulls last, pm.position limit 1
    ) img on true
    where ci.cart_id = ${input.cartId}
    order by ci.created_at, ci.id`);
  return result.rows.map((row) => ({
    itemId: row.item_id,
    variantId: row.variant_id,
    productId: row.product_id,
    brandId: row.brand_id,
    categoryIds: row.category_ids ?? [],
    sku: row.sku,
    sizeMl: row.size_ml,
    productName: row.product_name,
    productSlug: row.product_slug,
    brandName: row.brand_name,
    imageStorageKey: row.image_storage_key,
    imageUrl: row.image_url,
    unitPrice: Number(row.unit_price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    priceWhenAdded: Number(row.price_when_added),
    quantity: row.quantity,
    weightG: row.weight_g,
    available: Math.max(0, Number(row.available)),
    purchasable: row.purchasable,
  }));
}
