import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  brands,
  categoryTranslations,
  couponRedemptions,
  coupons,
  orders,
  productTranslations,
} from '@/server/db/schema';
import { containsPattern, pageOffset, type Paged } from '@/server/lib/sql-helpers';

import {
  couponState,
  type CouponScopeInput,
  type CouponSort,
  type CouponState,
} from './admin-schemas';

/* Admin read side for coupons: list and edit view with usage stats from coupon_redemptions. */

type Reader = Pick<Database, 'select'>;

export type CouponUsage = {
  redemptions: number;
  discountTotal: number;
  lastUsedAt: Date | null;
};

export type AdminCouponRow = {
  id: string;
  code: string;
  type: 'percent' | 'fixed' | 'free_shipping';
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  state: CouponState;
  usage: CouponUsage;
};

export type CouponListQuery = {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
};

/** Correlated to the outer `coupons` row (qualified: single-table selects are not). */
const outerCouponId = sql.raw('"coupons"."id"');
const redemptionCount = sql<number>`(select count(*)::int from ${couponRedemptions} where ${couponRedemptions.couponId} = ${outerCouponId})`;
const redemptionAmount = sql<string>`(select coalesce(sum(${couponRedemptions.amount}), 0) from ${couponRedemptions} where ${couponRedemptions.couponId} = ${outerCouponId})`;
const lastRedemption = sql<Date | null>`(select max(${couponRedemptions.createdAt}) from ${couponRedemptions} where ${couponRedemptions.couponId} = ${outerCouponId})`;

function couponOrder(sort: string, dir: 'asc' | 'desc'): SQL[] {
  const direction = dir === 'asc' ? asc : desc;
  switch (sort as CouponSort) {
    case 'code':
      return [direction(coupons.code)];
    case 'usedCount':
      return [direction(coupons.usedCount), asc(coupons.code)];
    case 'endsAt':
      return [sql`${coupons.endsAt} ${sql.raw(dir)} nulls last`, asc(coupons.code)];
    default:
      return [direction(coupons.createdAt)];
  }
}

export async function listCoupons(
  db: Reader,
  query: CouponListQuery,
  now: Date = new Date(),
): Promise<Paged<AdminCouponRow>> {
  const where = query.q
    ? sql`(${coupons.code} ilike ${containsPattern(query.q)} or ${coupons.note} ilike ${containsPattern(query.q)})`
    : undefined;
  const rows = await db
    .select({
      id: coupons.id,
      code: coupons.code,
      type: coupons.type,
      value: coupons.value,
      maxDiscount: coupons.maxDiscount,
      minSubtotal: coupons.minSubtotal,
      startsAt: coupons.startsAt,
      endsAt: coupons.endsAt,
      usageLimit: coupons.usageLimit,
      usedCount: coupons.usedCount,
      isActive: coupons.isActive,
      redemptions: redemptionCount.mapWith(Number),
      discountTotal: redemptionAmount.mapWith(Number),
      lastUsedAt: lastRedemption.mapWith((value) => (value ? new Date(value) : null)),
    })
    .from(coupons)
    .where(where)
    .orderBy(...couponOrder(query.sort, query.dir))
    .limit(query.pageSize)
    .offset(pageOffset(query.page, query.pageSize));
  const [totalRow] = await db.select({ total: count() }).from(coupons).where(where);
  return {
    rows: rows.map(({ redemptions, discountTotal, lastUsedAt, ...row }) => ({
      ...row,
      state: couponState(row, now),
      usage: { redemptions, discountTotal, lastUsedAt },
    })),
    total: totalRow?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export type CouponForEdit = {
  id: string;
  code: string;
  type: 'percent' | 'fixed' | 'free_shipping';
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  scope: CouponScopeInput;
  excludeSaleItems: boolean;
  isActive: boolean;
  note: string | null;
  state: CouponState;
  usage: CouponUsage & { uniqueCustomers: number };
  /** Names of the scoped entities, for the pickers' initial chips. */
  scopeLabels: { brands: Named[]; categories: Named[]; products: Named[] };
  recentRedemptions: { orderId: string; orderCode: string; amount: number; createdAt: Date }[];
};

type Named = { id: string; name: string };

function scopeOf(value: unknown): CouponScopeInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const list = (key: string) =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  return {
    brandIds: list('brandIds'),
    categoryIds: list('categoryIds'),
    productIds: list('productIds'),
  };
}

export async function getCouponForEdit(
  db: Reader,
  id: string,
  now: Date = new Date(),
): Promise<CouponForEdit | null> {
  const [row] = await db.select().from(coupons).where(eq(coupons.id, id));
  if (!row) return null;
  const scope = scopeOf(row.scope);
  const [stats, recent, brandRows, categoryRows, productRows] = await Promise.all([
    db
      .select({
        redemptions: count(),
        discountTotal: sql<string>`coalesce(sum(${couponRedemptions.amount}), 0)`.mapWith(Number),
        lastUsedAt: sql<Date | null>`max(${couponRedemptions.createdAt})`.mapWith((v) =>
          v ? new Date(v) : null,
        ),
        uniqueCustomers: sql<number>`count(distinct ${couponRedemptions.phone})::int`.mapWith(
          Number,
        ),
      })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, id)),
    db
      .select({
        orderId: orders.id,
        orderCode: orders.code,
        amount: couponRedemptions.amount,
        createdAt: couponRedemptions.createdAt,
      })
      .from(couponRedemptions)
      .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
      .where(eq(couponRedemptions.couponId, id))
      .orderBy(desc(couponRedemptions.createdAt))
      .limit(10),
    scope.brandIds.length
      ? db
          .select({ id: brands.id, name: brands.name })
          .from(brands)
          .where(inArray(brands.id, scope.brandIds))
      : Promise.resolve([] as Named[]),
    scope.categoryIds.length
      ? db
          .select({ id: categoryTranslations.categoryId, name: categoryTranslations.name })
          .from(categoryTranslations)
          .where(
            and(
              inArray(categoryTranslations.categoryId, scope.categoryIds),
              eq(categoryTranslations.locale, 'vi'),
            ),
          )
      : Promise.resolve([] as Named[]),
    scope.productIds.length
      ? db
          .select({ id: productTranslations.productId, name: productTranslations.name })
          .from(productTranslations)
          .where(
            and(
              inArray(productTranslations.productId, scope.productIds),
              eq(productTranslations.locale, 'vi'),
            ),
          )
      : Promise.resolve([] as Named[]),
  ]);
  const usage = stats[0] ?? {
    redemptions: 0,
    discountTotal: 0,
    lastUsedAt: null,
    uniqueCustomers: 0,
  };
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    maxDiscount: row.maxDiscount,
    minSubtotal: row.minSubtotal,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    usedCount: row.usedCount,
    scope,
    excludeSaleItems: row.excludeSaleItems,
    isActive: row.isActive,
    note: row.note,
    state: couponState(row, now),
    usage,
    scopeLabels: { brands: brandRows, categories: categoryRows, products: productRows },
    recentRedemptions: recent,
  };
}
