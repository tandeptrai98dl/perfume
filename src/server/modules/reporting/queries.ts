import { and, count, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  carts,
  codRemittanceOrders,
  orderItems,
  orders,
  payments,
  privacyRequests,
  products,
  productTranslations,
  refunds,
  reviews,
} from '@/server/db/schema';

import { VIETNAM_TIME_ZONE, type DateRange } from './range';

/*
 * Read-only reporting queries behind the KPI dashboard (§11.2). The reporting module owns no
 * table and never writes: it aggregates other modules' tables with a handful of grouped
 * queries (one round trip per widget, all run in parallel by the page). Every money figure is
 * an integer number of đồng; Postgres sums come back as text/bigint and are converted with
 * `Number` (exact far beyond any realistic shop turnover).
 */

type Reader = Pick<Database, 'select'>;

/** Order statuses that do not count as sales: unpaid/unconfirmed, or undone. */
export const NON_REVENUE_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'cancelled',
  'returned',
] as const;

/** COD orders whose cash is still with the carrier (same rule as COD reconciliation). */
const COD_REMITTABLE_STATUSES = ['delivered', 'completed', 'return_requested'] as const;

const toNumber = (value: unknown): number => Number(value ?? 0);

function inRange(column: typeof orders.placedAt, range: Pick<DateRange, 'start' | 'end'>) {
  return and(gte(column, range.start), lt(column, range.end));
}

const isRevenue = notInArray(orders.status, [...NON_REVENUE_STATUSES]);

export type SalesSummary = {
  /** Every order placed in the range, whatever its status. */
  ordersPlaced: number;
  /** Placed orders that count as sales (confirmed and not undone). */
  revenueOrders: number;
  /** Sum of `orders.total` of revenue orders. */
  grossSales: number;
  /** Refunded on those orders so far. */
  refunded: number;
  /** grossSales − refunded. */
  netRevenue: number;
  /** grossSales ÷ revenueOrders, rounded to the đồng (0 without orders). */
  averageOrderValue: number;
  /** Storefront orders placed (numerator of the conversion proxy). */
  webOrders: number;
  /** Carts created in the range (denominator of the conversion proxy). */
  cartsCreated: number;
  /** webOrders ÷ cartsCreated, or null without carts. */
  conversionRate: number | null;
};

/** Sales KPIs of orders placed in the range (accrual basis, by placement date). */
export async function salesSummary(db: Reader, range: DateRange): Promise<SalesSummary> {
  const [[row], [cartRow]] = await Promise.all([
    db
      .select({
        ordersPlaced: count(),
        revenueOrders: sql<number>`count(*) filter (where ${isRevenue})::int`,
        grossSales: sql<string>`coalesce(sum(${orders.total}) filter (where ${isRevenue}), 0)`,
        refunded: sql<string>`coalesce(sum(${orders.amountRefunded}) filter (where ${isRevenue}), 0)`,
        webOrders: sql<number>`count(*) filter (where ${orders.source} = 'web')::int`,
      })
      .from(orders)
      .where(inRange(orders.placedAt, range)),
    db
      .select({ n: count() })
      .from(carts)
      .where(and(gte(carts.createdAt, range.start), lt(carts.createdAt, range.end))),
  ]);
  const revenueOrders = row?.revenueOrders ?? 0;
  const grossSales = toNumber(row?.grossSales);
  const refunded = toNumber(row?.refunded);
  const webOrders = row?.webOrders ?? 0;
  const cartsCreated = cartRow?.n ?? 0;
  return {
    ordersPlaced: row?.ordersPlaced ?? 0,
    revenueOrders,
    grossSales,
    refunded,
    netRevenue: grossSales - refunded,
    averageOrderValue: revenueOrders ? Math.round(grossSales / revenueOrders) : 0,
    webOrders,
    cartsCreated,
    conversionRate: cartsCreated ? webOrders / cartsCreated : null,
  };
}

export type CashSummary = {
  /** Successful payments (gateway, bank transfer, COD remittance) received in the range. */
  received: number;
  /** Refunds completed in the range. */
  refunded: number;
  /** received − refunded. */
  net: number;
};

/** Money actually collected in the range (cash basis): payments received minus refunds paid. */
export async function cashSummary(db: Reader, range: DateRange): Promise<CashSummary> {
  const [[paid], [refundedRow]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(
          // A refunded payment was still received; the refund is subtracted on its own date.
          inArray(payments.status, ['succeeded', 'refunded']),
          gte(payments.paidAt, range.start),
          lt(payments.paidAt, range.end),
        ),
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
      .from(refunds)
      .where(
        and(
          eq(refunds.status, 'completed'),
          gte(refunds.completedAt, range.start),
          lt(refunds.completedAt, range.end),
        ),
      ),
  ]);
  const received = toNumber(paid?.total);
  const refunded = toNumber(refundedRow?.total);
  return { received, refunded, net: received - refunded };
}

export type DailyPoint = { day: string; netRevenue: number; orders: number };

/** Net revenue and revenue orders per Vietnam calendar day; days without sales are zero. */
export async function dailyRevenue(db: Reader, range: DateRange): Promise<DailyPoint[]> {
  // The zone is a constant inlined as a literal: a bind parameter would differ between the
  // SELECT and GROUP BY expressions ($1 vs $8) and Postgres would reject the grouping.
  const zone = sql.raw(`'${VIETNAM_TIME_ZONE}'`);
  const day = sql<string>`to_char(${orders.placedAt} at time zone ${zone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      netRevenue: sql<string>`coalesce(sum(${orders.total} - ${orders.amountRefunded}), 0)`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(inRange(orders.placedAt, range), isRevenue))
    .groupBy(day);
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return range.days.map((d) => ({
    day: d,
    netRevenue: toNumber(byDay.get(d)?.netRevenue),
    orders: byDay.get(d)?.orders ?? 0,
  }));
}

export type StatusCount = { status: (typeof orders.status.enumValues)[number]; orders: number };

/** Orders placed in the range by their current status, largest first. */
export async function ordersByStatus(db: Reader, range: DateRange): Promise<StatusCount[]> {
  const rows = await db
    .select({ status: orders.status, orders: count() })
    .from(orders)
    .where(inRange(orders.placedAt, range))
    .groupBy(orders.status);
  return rows.sort((a, b) => b.orders - a.orders || a.status.localeCompare(b.status));
}

export type TopProduct = {
  productId: string;
  name: string;
  units: number;
  /** Line totals after discounts (đồng). */
  revenue: number;
};

/** Best sellers by units in revenue orders placed in the range (ties broken by revenue). */
export async function topProducts(db: Reader, range: DateRange, limit = 10): Promise<TopProduct[]> {
  const units = sql<number>`sum(${orderItems.quantity})::int`;
  const revenue = sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`;
  const rows = await db
    .select({
      productId: orderItems.productId,
      // Current Vietnamese name; the order snapshot when the product was renamed or deleted.
      name: sql<string>`coalesce(${productTranslations.name}, max(${orderItems.productName}))`,
      units,
      revenue,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, orderItems.productId),
        eq(productTranslations.locale, 'vi'),
      ),
    )
    .where(and(inRange(orders.placedAt, range), isRevenue))
    .groupBy(orderItems.productId, productTranslations.name)
    .orderBy(desc(units), desc(revenue))
    .limit(limit);
  return rows.map((row) => ({ ...row, revenue: toNumber(row.revenue) }));
}

export type CodPending = { orders: number; amount: number };

/** Delivered COD orders whose cash has not been remitted by the carrier yet (live). */
export async function codPendingRemittance(db: Reader): Promise<CodPending> {
  const [row] = await db
    .select({
      orders: sql<number>`count(distinct ${orders.id})::int`,
      amount: sql<string>`coalesce(sum(${orders.amountDue}), 0)`,
    })
    .from(orders)
    .leftJoin(codRemittanceOrders, eq(codRemittanceOrders.orderId, orders.id))
    .where(
      and(
        eq(orders.paymentMethod, 'cod'),
        inArray(orders.status, [...COD_REMITTABLE_STATUSES]),
        sql`${orders.amountDue} > 0`,
        isNull(codRemittanceOrders.orderId),
      ),
    );
  return { orders: row?.orders ?? 0, amount: toNumber(row?.amount) };
}

export async function pendingReviewCount(db: Reader): Promise<number> {
  const [row] = await db.select({ n: count() }).from(reviews).where(eq(reviews.status, 'pending'));
  return row?.n ?? 0;
}

export type OpenRefunds = { count: number; amount: number };

/** Refunds requested or in progress (the payments refund queue). */
export async function openRefunds(db: Reader): Promise<OpenRefunds> {
  const [row] = await db
    .select({ n: count(), amount: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
    .from(refunds)
    .where(inArray(refunds.status, ['requested', 'processing']));
  return { count: row?.n ?? 0, amount: toNumber(row?.amount) };
}

export type OpenPrivacyRequests = { open: number; overdue: number };

/** Privacy requests not yet answered, and how many are past their legal due date. */
export async function openPrivacyRequests(
  db: Reader,
  now: Date = new Date(),
): Promise<OpenPrivacyRequests> {
  const [row] = await db
    .select({
      open: count(),
      overdue: sql<number>`count(*) filter (where ${privacyRequests.dueAt} < ${now})::int`,
    })
    .from(privacyRequests)
    .where(inArray(privacyRequests.status, ['received', 'in_progress']));
  return { open: row?.open ?? 0, overdue: row?.overdue ?? 0 };
}

export type TranslationCoverage = { activeProducts: number; missingEnglish: number };

/** Active products without a published English translation (D21 go-live gate: ≥ 80 %). */
export async function englishCoverage(db: Reader): Promise<TranslationCoverage> {
  const [row] = await db
    .select({
      activeProducts: count(),
      // Table-qualified on purpose: Drizzle renders select-list columns unqualified.
      missingEnglish: sql<number>`count(*) filter (where not exists (
        select 1 from "product_translations" t
        where t.product_id = "products"."id" and t.locale = 'en' and t.is_published
      ))::int`,
    })
    .from(products)
    .where(and(eq(products.status, 'active'), isNull(products.deletedAt)));
  return { activeProducts: row?.activeProducts ?? 0, missingEnglish: row?.missingEnglish ?? 0 };
}
