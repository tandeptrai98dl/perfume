import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  brands,
  inventoryItems,
  productTranslations,
  productVariants,
  products,
  stockMovements,
  users,
} from '@/server/db/schema';
import { foldedContains, pageOffset, type Paged } from '@/server/lib/sql-helpers';

/*
 * Admin read side for inventory: stock per variant, low-stock list and the movement log.
 * Reserved stays 0 until reservations arrive with orders (M2).
 */

type Reader = Pick<Database, 'select'>;

export type StockRow = {
  variantId: string;
  productId: string;
  productName: string;
  brandName: string;
  sku: string;
  sizeMl: number;
  variantType: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
};

export const STOCK_SORTS = ['product', 'sku', 'onHand', 'available'] as const;
export type StockSort = (typeof STOCK_SORTS)[number];

export type StockListQuery = {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
  lowOnly?: boolean;
};

const onHand = sql<number>`coalesce(${inventoryItems.onHand}, 0)`;
const reserved = sql<number>`coalesce(${inventoryItems.reserved}, 0)`;
const available = sql<number>`greatest(coalesce(${inventoryItems.onHand}, 0) - coalesce(${inventoryItems.reserved}, 0), 0)`;
const threshold = sql<number>`coalesce(${inventoryItems.lowStockThreshold}, 3)`;
const isLow = sql<boolean>`(${available} <= ${threshold})`;

function stockBase(db: Reader) {
  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: sql<string>`coalesce(${productTranslations.name}, '')`,
      brandName: brands.name,
      sku: productVariants.sku,
      sizeMl: productVariants.sizeMl,
      variantType: productVariants.variantType,
      isActive: productVariants.isActive,
      onHand: onHand.mapWith(Number),
      reserved: reserved.mapWith(Number),
      available: available.mapWith(Number),
      lowStockThreshold: threshold.mapWith(Number),
      isLow: isLow.mapWith(Boolean),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'vi')),
    )
    .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id));
}

function stockWhere(query: Pick<StockListQuery, 'q' | 'lowOnly'>): SQL | undefined {
  const conditions: (SQL | undefined)[] = [isNull(products.deletedAt)];
  if (query.q) {
    conditions.push(
      or(
        foldedContains(productVariants.sku, query.q),
        foldedContains(productTranslations.name, query.q),
        foldedContains(brands.name, query.q),
      ),
    );
  }
  if (query.lowOnly) conditions.push(isLow, eq(productVariants.isActive, true));
  return and(...conditions);
}

function stockOrder(sort: string, dir: 'asc' | 'desc'): SQL[] {
  const direction = dir === 'asc' ? asc : desc;
  switch (sort as StockSort) {
    case 'sku':
      return [direction(productVariants.sku)];
    case 'onHand':
      return [direction(onHand), asc(productVariants.sku)];
    case 'available':
      return [direction(available), asc(productVariants.sku)];
    default:
      return [direction(productTranslations.name), asc(productVariants.position)];
  }
}

export async function listStock(db: Reader, query: StockListQuery): Promise<Paged<StockRow>> {
  const where = stockWhere(query);
  const rows = await stockBase(db)
    .where(where)
    .orderBy(...stockOrder(query.sort, query.dir))
    .limit(query.pageSize)
    .offset(pageOffset(query.page, query.pageSize));
  const [totalRow] = await db
    .select({ total: count() })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'vi')),
    )
    .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
    .where(where);
  return { rows, total: totalRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

/** Active variants at or below their threshold, lowest availability first (dashboard widget). */
export async function listLowStock(db: Reader, limit = 10): Promise<StockRow[]> {
  return stockBase(db)
    .where(stockWhere({ q: '', lowOnly: true }))
    .orderBy(asc(available), asc(productVariants.sku))
    .limit(limit);
}

export async function getStockForVariants(db: Reader, productId: string): Promise<StockRow[]> {
  return stockBase(db)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position));
}

export type MovementRow = {
  id: string;
  createdAt: Date;
  variantId: string;
  sku: string;
  productName: string;
  delta: number;
  reason: string;
  note: string | null;
  actorName: string | null;
};

export async function listMovements(
  db: Reader,
  query: { variantId?: string | null; q?: string; page: number; pageSize: number },
): Promise<Paged<MovementRow>> {
  const conditions: (SQL | undefined)[] = [];
  if (query.variantId) conditions.push(eq(stockMovements.variantId, query.variantId));
  if (query.q) {
    conditions.push(
      or(
        foldedContains(productVariants.sku, query.q),
        foldedContains(productTranslations.name, query.q),
      ),
    );
  }
  const where = and(...conditions);
  const rows = await db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      variantId: stockMovements.variantId,
      sku: productVariants.sku,
      productName: sql<string>`coalesce(${productTranslations.name}, '')`,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      note: stockMovements.note,
      actorName: users.name,
    })
    .from(stockMovements)
    .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, productVariants.productId),
        eq(productTranslations.locale, 'vi'),
      ),
    )
    .leftJoin(users, eq(users.id, stockMovements.actorId))
    .where(where)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(query.pageSize)
    .offset(pageOffset(query.page, query.pageSize));
  const [totalRow] = await db
    .select({ total: count() })
    .from(stockMovements)
    .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, productVariants.productId),
        eq(productTranslations.locale, 'vi'),
      ),
    )
    .where(where);
  return { rows, total: totalRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

/** One variant's stock (low-stock alert details); null when the variant or product is gone. */
export async function getVariantStock(db: Reader, variantId: string): Promise<StockRow | null> {
  const [row] = await stockBase(db)
    .where(and(eq(productVariants.id, variantId), isNull(products.deletedAt)))
    .limit(1);
  return row ?? null;
}
