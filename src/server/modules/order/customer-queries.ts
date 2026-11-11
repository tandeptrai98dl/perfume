import { and, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderEvents, orderItems, orders, shipments } from '@/server/db/schema';
import { pageOffset, type Paged } from '@/server/lib/sql-helpers';

import { ORDER_CODE_PATTERN } from './codes';
import { customerCanCancel, type OrderStatus } from './state-machine';

/*
 * Customer-facing order reads (account area, guest lookup, emails). Every account query is
 * scoped by `user_id` (IDOR protection, ARCHITECTURE.md §12): a customer can never load another
 * customer's order by guessing its code. No Next.js APIs (the worker uses `getOrderViewById`).
 */

type Reader = Pick<Database, 'select'>;

export type OrderTimelineEntry = { status: OrderStatus; at: Date };

export type OrderView = {
  id: string;
  code: string;
  userId: string | null;
  status: OrderStatus;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded';
  paymentMethod: 'cod' | 'vnpay' | 'payos' | 'bank_transfer' | 'momo' | 'zalopay';
  locale: 'vi' | 'en';
  placedAt: Date;
  customerName: string;
  email: string;
  phone: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountRefunded: number;
  amountDue: number;
  couponCode: string | null;
  giftWrap: boolean;
  giftMessage: string | null;
  customerNote: string | null;
  items: Array<{
    id: string;
    productName: string;
    variantLabel: string;
    sku: string;
    imageUrl: string | null;
    unitPrice: number;
    compareAtPrice: number | null;
    quantity: number;
    discountAllocated: number;
    lineTotal: number;
  }>;
  shippingAddress: {
    fullName: string;
    phone: string;
    street: string;
    wardName: string;
    provinceName: string;
    provinceCode: string;
  } | null;
  shipments: Array<{
    carrier: 'self' | 'ghn' | 'ghtk' | 'viettel_post' | 'other';
    trackingCode: string;
    status: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  }>;
  /** Status history, oldest first, starting with the status the order was placed in. */
  timeline: OrderTimelineEntry[];
  /** The customer may cancel now (before processing, §10.5). */
  canCancel: boolean;
};

export type CustomerOrderRow = {
  code: string;
  status: OrderStatus;
  paymentStatus: OrderView['paymentStatus'];
  paymentMethod: OrderView['paymentMethod'];
  total: number;
  placedAt: Date;
  itemCount: number;
};

/** Order codes are shown upper-case; customers may type them in any case or with spaces. */
export function normalizeOrderCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

async function loadView(db: Reader, where: SQL | undefined): Promise<OrderView | null> {
  const [order] = await db.select().from(orders).where(where).limit(1);
  if (!order) return null;

  const [items, addresses, events, parcels] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        sku: orderItems.sku,
        imageUrl: orderItems.imageUrl,
        unitPrice: orderItems.unitPrice,
        compareAtPrice: orderItems.compareAtPrice,
        quantity: orderItems.quantity,
        discountAllocated: orderItems.discountAllocated,
        lineTotal: orderItems.lineTotal,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    db
      .select({
        fullName: orderAddresses.fullName,
        phone: orderAddresses.phone,
        street: orderAddresses.street,
        wardName: orderAddresses.wardName,
        provinceName: orderAddresses.provinceName,
        provinceCode: orderAddresses.provinceCode,
      })
      .from(orderAddresses)
      .where(and(eq(orderAddresses.orderId, order.id), eq(orderAddresses.type, 'shipping')))
      .limit(1),
    db
      .select({
        fromStatus: orderEvents.fromStatus,
        toStatus: orderEvents.toStatus,
        createdAt: orderEvents.createdAt,
      })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'status_changed')))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
    db
      .select({
        carrier: shipments.carrier,
        trackingCode: shipments.trackingCode,
        status: shipments.status,
        shippedAt: shipments.shippedAt,
        deliveredAt: shipments.deliveredAt,
      })
      .from(shipments)
      .where(eq(shipments.orderId, order.id))
      .orderBy(asc(shipments.createdAt)),
  ]);

  const status = order.status as OrderStatus;
  const initial = (events[0]?.fromStatus ?? status) as OrderStatus;
  const timeline: OrderTimelineEntry[] = [{ status: initial, at: order.placedAt }];
  for (const event of events) {
    if (event.toStatus)
      timeline.push({ status: event.toStatus as OrderStatus, at: event.createdAt });
  }

  return {
    id: order.id,
    code: order.code,
    userId: order.userId,
    status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    locale: order.locale,
    placedAt: order.placedAt,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    depositRequired: order.depositRequired,
    amountPaid: order.amountPaid,
    amountRefunded: order.amountRefunded,
    amountDue: order.amountDue,
    couponCode: order.couponCode,
    giftWrap: order.giftWrap,
    giftMessage: order.giftMessage,
    customerNote: order.customerNote,
    items,
    shippingAddress: addresses[0] ?? null,
    shipments: parcels,
    timeline,
    canCancel: customerCanCancel(status),
  };
}

/** A signed-in customer's own order, or null (also for other customers' codes). */
export async function getCustomerOrder(
  db: Reader,
  input: { userId: string; code: string },
): Promise<OrderView | null> {
  const code = normalizeOrderCode(input.code);
  if (!ORDER_CODE_PATTERN.test(code)) return null;
  return loadView(db, and(eq(orders.code, code), eq(orders.userId, input.userId)));
}

/** Order history of a signed-in customer, newest first. */
export async function listCustomerOrders(
  db: Reader,
  input: { userId: string; page?: number; pageSize?: number },
): Promise<Paged<CustomerOrderRow>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? 10;
  // Qualified names: inside a sub-select Drizzle renders bare column names.
  const itemCount = sql<number>`(
    select coalesce(sum(oi.quantity), 0)::int from ${orderItems} oi where oi.order_id = ${orders}.id
  )`;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        code: orders.code,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        paymentMethod: orders.paymentMethod,
        total: orders.total,
        placedAt: orders.placedAt,
        itemCount,
      })
      .from(orders)
      .where(eq(orders.userId, input.userId))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ n: count() }).from(orders).where(eq(orders.userId, input.userId)),
  ]);
  return {
    rows: rows.map((row) => ({ ...row, status: row.status as OrderStatus })),
    total: totalRow?.n ?? 0,
    page,
    pageSize,
  };
}

/** Digits of a phone in national form (`+84…`/`84…` → `0…`), as SQL, for tolerant matching. */
function nationalDigits(column: typeof orders.phone | typeof orderAddresses.phone) {
  return sql`regexp_replace(regexp_replace(${column}, '\\D', '', 'g'), '^84', '0')`;
}

/**
 * Guest lookup (§10.5): the order code plus the contact or delivery phone. Returns the code
 * only when both match; callers show one generic error otherwise (no hint which part failed).
 * `phone` must already be normalised (`0xxxxxxxxx`).
 */
export async function findOrderCodeForLookup(
  db: Reader,
  input: { code: string; phone: string },
): Promise<string | null> {
  const code = normalizeOrderCode(input.code);
  if (!ORDER_CODE_PATTERN.test(code)) return null;
  const [row] = await db
    .select({ code: orders.code })
    .from(orders)
    .leftJoin(
      orderAddresses,
      and(eq(orderAddresses.orderId, orders.id), eq(orderAddresses.type, 'shipping')),
    )
    .where(
      and(
        eq(orders.code, code),
        or(
          sql`${nationalDigits(orders.phone)} = ${input.phone}`,
          sql`${nationalDigits(orderAddresses.phone)} = ${input.phone}`,
        ),
      ),
    )
    .limit(1);
  return row?.code ?? null;
}

/** Read-only view by code, for guests whose access was already verified (lookup or token). */
export async function getOrderViewByCode(db: Reader, code: string): Promise<OrderView | null> {
  const normalized = normalizeOrderCode(code);
  if (!ORDER_CODE_PATTERN.test(normalized)) return null;
  return loadView(db, eq(orders.code, normalized));
}

/** Worker/notifications: full view by id. */
export async function getOrderViewById(db: Reader, orderId: string): Promise<OrderView | null> {
  return loadView(db, eq(orders.id, orderId));
}
