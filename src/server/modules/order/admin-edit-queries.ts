import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { mediaUrl } from '@/lib/media-url';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderEvents, orderItems, orders } from '@/server/db/schema';
import { variantLabel, type SnapshotVariantType } from '@/server/modules/checkout/labels';
import { listProvinces, listWards, type AdminUnit } from '@/server/modules/customer';
import { availableQuantitySql } from '@/server/modules/inventory';

import type { CatalogVariant, CurrentLine, EditAddress } from './admin-edit-plan';
import { canEditOrder } from './admin-edit-plan';
import type { PaymentMethod, PaymentStatus } from './admin-schemas';
import type { OrderStatus } from './state-machine';

/*
 * Reads for the admin order edit (§11.2 "Order edits"): the edit form, the catalogue facts of
 * variants (price, weight, stock, whether still sold) and the variant picker. Decants are never
 * offered (ADR-0015). Read-only: catalogue/inventory tables are owned by their modules.
 */

type Reader = Pick<Database, 'select' | 'execute'>;

/** `order_events.type` of an edit. */
export const ORDER_EDITED_EVENT = 'edited';

type VariantRow = {
  variant_id: string;
  product_id: string;
  brand_id: string;
  category_ids: string[] | null;
  sku: string;
  size_ml: number;
  variant_type: SnapshotVariantType;
  product_name: string | null;
  brand_name: string;
  image_storage_key: string | null;
  image_url: string | null;
  price: string | number;
  compare_at_price: string | number | null;
  weight_g: number;
  available: number | string;
  purchasable: boolean;
};

export type EditVariantOption = CatalogVariant & { brandName: string };

function variantSelect() {
  return sql`
    select v.id as variant_id, p.id as product_id, b.id as brand_id,
      (select array_agg(pc.category_id) from product_categories pc where pc.product_id = p.id) as category_ids,
      v.sku, v.size_ml, v.variant_type, pt_vi.name as product_name, b.name as brand_name,
      img.storage_key as image_storage_key, img.url as image_url,
      v.price, v.compare_at_price, v.weight_g,
      ${availableQuantitySql(sql`v.id`)} as available,
      (v.is_active and v.variant_type <> 'decant' and p.status = 'active' and p.deleted_at is null
        and b.status = 'active' and b.deleted_at is null and coalesce(pt_vi.is_published, false)) as purchasable
    from product_variants v
    join products p on p.id = v.product_id
    join brands b on b.id = p.brand_id
    left join product_translations pt_vi on pt_vi.product_id = p.id and pt_vi.locale = 'vi'
    left join lateral (
      select m.storage_key, m.url from product_media pm join media m on m.id = pm.media_id
      where pm.product_id = p.id and (pm.variant_id is null or pm.variant_id = v.id)
      order by (pm.variant_id = v.id) desc nulls last, pm.position limit 1
    ) img on true`;
}

function toVariant(row: VariantRow, locale: 'vi' | 'en'): EditVariantOption {
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    brandId: row.brand_id,
    brandName: row.brand_name,
    categoryIds: row.category_ids ?? [],
    productName: row.product_name ?? row.sku,
    variantLabel: variantLabel(locale, row.variant_type, row.size_ml),
    sku: row.sku,
    imageUrl: row.image_storage_key
      ? mediaUrl(row.image_storage_key, row.image_url)
      : row.image_url,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    weightG: row.weight_g,
    available: Math.max(0, Number(row.available)),
    purchasable: row.purchasable,
  };
}

/** Catalogue facts of the given variants (labels in the order's locale). */
export async function loadEditCatalog(
  db: Reader,
  variantIds: readonly string[],
  locale: 'vi' | 'en',
): Promise<Map<string, EditVariantOption>> {
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return new Map();
  const result = await db.execute<VariantRow>(
    sql`${variantSelect()} where v.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`,
  );
  return new Map(result.rows.map((row) => [row.variant_id, toVariant(row, locale)]));
}

const SEARCH_LIMIT = 20;

/**
 * Variant picker: sellable variants (never decants) matching name, brand or SKU, with their
 * available stock. An empty query lists the first variants alphabetically.
 */
export async function searchEditVariants(
  db: Reader,
  input: { q: string; locale: 'vi' | 'en'; limit?: number },
): Promise<EditVariantOption[]> {
  const q = input.q.trim();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const filter = q
    ? sql`and (pt_vi.name ilike ${pattern} or b.name ilike ${pattern} or v.sku ilike ${pattern})`
    : sql``;
  const result = await db.execute<VariantRow>(sql`
    ${variantSelect()}
    where v.is_active and v.variant_type <> 'decant' and p.status = 'active' and p.deleted_at is null
      and b.status = 'active' and b.deleted_at is null and coalesce(pt_vi.is_published, false)
      ${filter}
    order by b.name, pt_vi.name, v.position, v.size_ml
    limit ${input.limit ?? SEARCH_LIMIT}`);
  return result.rows.map((row) => toVariant(row, input.locale));
}

export type OrderEditForm = {
  id: string;
  code: string;
  version: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  locale: 'vi' | 'en';
  editable: boolean;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountRefunded: number;
  couponCode: string | null;
  /** Shipping fee override in force from an earlier edit (null = rate table). */
  shippingFeeOverride: number | null;
  items: (CurrentLine & { available: number; purchasable: boolean })[];
  address: EditAddress | null;
  provinces: AdminUnit[];
  /** Wards of the current province (others load on demand). */
  wards: AdminUnit[];
};

/** Shipping fee override in force: the one written by the latest edit, if any. */
export async function currentShippingFeeOverride(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<number | null> {
  const [last] = await db
    .select({ metadata: orderEvents.metadata })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, ORDER_EDITED_EVENT)))
    .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
    .limit(1);
  const value = (last?.metadata as { shippingFeeOverride?: unknown } | null)?.shippingFeeOverride;
  return typeof value === 'number' ? value : null;
}

export async function getCurrentLines(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<CurrentLine[]> {
  return db
    .select({
      variantId: orderItems.variantId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      sku: orderItems.sku,
      imageUrl: orderItems.imageUrl,
      unitPrice: orderItems.unitPrice,
      compareAtPrice: orderItems.compareAtPrice,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
}

export async function getShippingAddress(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<EditAddress | null> {
  const [row] = await db
    .select({
      fullName: orderAddresses.fullName,
      phone: orderAddresses.phone,
      provinceCode: orderAddresses.provinceCode,
      provinceName: orderAddresses.provinceName,
      wardCode: orderAddresses.wardCode,
      wardName: orderAddresses.wardName,
      street: orderAddresses.street,
    })
    .from(orderAddresses)
    .where(and(eq(orderAddresses.orderId, orderId), eq(orderAddresses.type, 'shipping')));
  return row ?? null;
}

/** Everything the edit page needs (contact shown in full: editors of orders may see it). */
export async function getOrderEditForm(db: Reader, orderId: string): Promise<OrderEditForm | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const [lines, address, override, provinces] = await Promise.all([
    getCurrentLines(db, orderId),
    getShippingAddress(db, orderId),
    currentShippingFeeOverride(db, orderId),
    listProvinces(db),
  ]);
  const [catalog, wards] = await Promise.all([
    loadEditCatalog(
      db,
      lines.map((line) => line.variantId),
      order.locale,
    ),
    address ? listWards(db, address.provinceCode) : Promise.resolve([]),
  ]);
  const status = order.status as OrderStatus;
  return {
    id: order.id,
    code: order.code,
    version: order.version,
    status,
    paymentStatus: order.paymentStatus as PaymentStatus,
    paymentMethod: order.paymentMethod as PaymentMethod,
    locale: order.locale,
    editable: canEditOrder(status),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    depositRequired: order.depositRequired,
    amountPaid: order.amountPaid,
    amountRefunded: order.amountRefunded,
    couponCode: order.couponCode,
    shippingFeeOverride: override,
    items: lines.map((line) => ({
      ...line,
      available: catalog.get(line.variantId)?.available ?? 0,
      purchasable: catalog.get(line.variantId)?.purchasable ?? false,
    })),
    address,
    provinces,
    wards,
  };
}
