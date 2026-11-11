import { sql, type SQL } from 'drizzle-orm';

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/server/db/client';
import type { CartLine, VariantType } from '@/server/modules/cart';
import { availableQuantitySql } from '@/server/modules/inventory';

/*
 * Lines of a manual (staff) order (§3.4 step 7, §11.2): the variants a staff member picked,
 * read with the same live catalogue prices, availability and "purchasable" rule as cart lines
 * (`getCartLines`), so `priceCart` and the stock checks see exactly what a web checkout would.
 * Decants are never purchasable (ADR-0015) and never listed by the picker.
 */

type Executor = Pick<Database, 'execute'>;

export type LineRequest = { variantId: string; quantity: number };

type LineRow = {
  variant_id: string;
  product_id: string;
  brand_id: string;
  category_ids: string[] | null;
  sku: string;
  size_ml: number;
  variant_type: VariantType;
  product_name: string;
  product_slug: string | null;
  brand_name: string;
  image_storage_key: string | null;
  image_url: string | null;
  unit_price: string | number;
  compare_at_price: string | number | null;
  weight_g: number;
  available: string | number;
  purchasable: boolean;
};

/** Merges repeated variants (quantities add up), keeping the first position. */
export function mergeLineRequests(items: readonly LineRequest[]): LineRequest[] {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

const PURCHASABLE = sql`(v.is_active and v.variant_type <> 'decant' and p.status = 'active'
  and p.deleted_at is null and b.status = 'active' and b.deleted_at is null
  and coalesce(pt_vi.is_published, false))`;

function lineSelect(locale: Locale, from: SQL, where: SQL, orderBy: SQL, limit?: number): SQL {
  return sql`
    select v.id as variant_id, p.id as product_id, b.id as brand_id,
      (select array_agg(pc.category_id) from product_categories pc where pc.product_id = p.id) as category_ids,
      v.sku, v.size_ml, v.variant_type,
      coalesce(pt_loc.name, pt_vi.name, '') as product_name,
      coalesce(pt_loc.slug, pt_vi.slug) as product_slug,
      b.name as brand_name,
      img.storage_key as image_storage_key, img.url as image_url,
      v.price as unit_price, v.compare_at_price, v.weight_g,
      ${availableQuantitySql(sql`v.id`)} as available,
      ${PURCHASABLE} as purchasable
    ${from}
    join products p on p.id = v.product_id
    join brands b on b.id = p.brand_id
    left join product_translations pt_vi on pt_vi.product_id = p.id and pt_vi.locale = 'vi'
    left join product_translations pt_loc on pt_loc.product_id = p.id and pt_loc.locale = ${locale}
      and pt_loc.is_published
    left join lateral (
      select m.storage_key, m.url from product_media pm join media m on m.id = pm.media_id
      where pm.product_id = p.id and (pm.variant_id is null or pm.variant_id = v.id)
      order by (pm.variant_id = v.id) desc nulls last, pm.position limit 1
    ) img on true
    where ${where}
    order by ${orderBy}
    ${limit ? sql`limit ${limit}` : sql``}`;
}

function toLine(row: LineRow, quantity: number): CartLine {
  return {
    itemId: row.variant_id,
    variantId: row.variant_id,
    productId: row.product_id,
    brandId: row.brand_id,
    categoryIds: row.category_ids ?? [],
    sku: row.sku,
    sizeMl: row.size_ml,
    variantType: row.variant_type,
    productName: row.product_name,
    productSlug: row.product_slug,
    brandName: row.brand_name,
    imageStorageKey: row.image_storage_key,
    imageUrl: row.image_url,
    unitPrice: Number(row.unit_price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    priceWhenAdded: Number(row.unit_price),
    quantity,
    weightG: row.weight_g,
    available: Math.max(0, Number(row.available)),
    purchasable: row.purchasable,
  };
}

/**
 * Picked variants as checkout lines (live price, availability, names in `locale` with the
 * Vietnamese fallback). Unknown variant ids are dropped; the caller reports them.
 */
export async function getVariantLines(
  db: Executor,
  input: { items: readonly LineRequest[]; locale: Locale },
): Promise<CartLine[]> {
  const items = mergeLineRequests(input.items);
  if (items.length === 0) return [];
  const values = sql.join(
    items.map((item, index) => sql`(${item.variantId}::uuid, ${index}::int)`),
    sql`, `,
  );
  const result = await db.execute<LineRow & { position: number }>(
    lineSelect(
      input.locale,
      sql`from (values ${values}) as picked(variant_id, position)
        join product_variants v on v.id = picked.variant_id`,
      sql`true`,
      sql`picked.position`,
    ),
  );
  const quantities = new Map(items.map((item) => [item.variantId, item.quantity]));
  return result.rows.map((row) => toLine(row, quantities.get(row.variant_id) ?? 0));
}

export type OrderableVariant = {
  variantId: string;
  productName: string;
  brandName: string;
  sku: string;
  sizeMl: number;
  variantType: Exclude<VariantType, 'decant'>;
  unitPrice: number;
  compareAtPrice: number | null;
  available: number;
};

/**
 * Variant picker of manual orders: sellable variants (never decants) whose SKU, product or
 * brand name contains `q` (accent-insensitive), with live availability. In-stock first.
 */
export async function searchOrderableVariants(
  db: Executor,
  input: { q: string; limit?: number },
): Promise<OrderableVariant[]> {
  const q = input.q.trim();
  if (!q) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const matches = sql`(immutable_unaccent(v.sku) ilike immutable_unaccent(${pattern})
    or immutable_unaccent(coalesce(pt_vi.name, '')) ilike immutable_unaccent(${pattern})
    or immutable_unaccent(b.name) ilike immutable_unaccent(${pattern}))`;
  const result = await db.execute<LineRow>(
    lineSelect(
      'vi',
      sql`from product_variants v`,
      sql`${PURCHASABLE} and ${matches}`,
      sql`(${availableQuantitySql(sql`v.id`)} > 0) desc, product_name, v.position, v.sku`,
      Math.min(input.limit ?? 12, 50),
    ),
  );
  return result.rows.map((row) => {
    const line = toLine(row, 0);
    return {
      variantId: line.variantId,
      productName: line.productName,
      brandName: line.brandName,
      sku: line.sku,
      sizeMl: line.sizeMl,
      variantType: line.variantType as OrderableVariant['variantType'],
      unitPrice: line.unitPrice,
      compareAtPrice: line.compareAtPrice,
      available: line.available,
    };
  });
}
