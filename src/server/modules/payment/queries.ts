import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  codRemittanceOrders,
  codRemittances,
  media,
  orderItems,
  orders,
  paymentEvents,
  payments,
  refunds,
  shipments,
  users,
} from '@/server/db/schema';

import { toSessionView, reservationExpiry } from './sessions';
import { nextSessionAmount, type PaymentStatus } from './status';
import type { PaymentSessionView } from './types';

/*
 * Read side of the payment module: the checkout result page, its polling endpoint and the
 * admin payment screens. Reads never change state (return URLs only display status).
 */

type Reader = Pick<Database, 'select'>;

// ---------- Storefront ----------

export type CheckoutResultItem = {
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type CheckoutResult = {
  orderId: string;
  code: string;
  userId: string | null;
  locale: 'vi' | 'en';
  status: string;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountDue: number;
  /** Still due online before confirmation (0 for COD without deposit or once covered). */
  onlineDue: number;
  placedAt: Date;
  items: CheckoutResultItem[];
  /** Latest attempt (any status) and whether it can still be paid. */
  session: PaymentSessionView | null;
  sessionUsable: boolean;
  /** Earliest expiry of active reservations; null when none are left. */
  reservedUntil: Date | null;
  attempts: number;
};

export async function findOrderByCode(db: Reader, code: string) {
  const [order] = await db.select().from(orders).where(eq(orders.code, code)).limit(1);
  return order ?? null;
}

export async function getCheckoutResult(
  db: Reader,
  code: string,
  now: Date = new Date(),
): Promise<CheckoutResult | null> {
  const order = await findOrderByCode(db, code);
  if (!order) return null;
  const [items, attempts, reservedUntil] = await Promise.all([
    db
      .select({
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        imageUrl: orderItems.imageUrl,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        lineTotal: orderItems.lineTotal,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.createdAt)),
    db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), inArray(payments.provider, ['vnpay', 'payos'])))
      .orderBy(desc(payments.createdAt)),
    reservationExpiry(db, order.id),
  ]);
  const latest = attempts[0] ?? null;
  const sessionUsable =
    !!latest &&
    latest.status === 'pending' &&
    !!latest.expiresAt &&
    latest.expiresAt.getTime() > now.getTime() &&
    !!(latest.checkoutUrl || latest.qrCode);
  return {
    orderId: order.id,
    code: order.code,
    userId: order.userId,
    locale: order.locale,
    status: order.status,
    paymentStatus: order.paymentStatus as PaymentStatus,
    paymentMethod: order.paymentMethod,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    depositRequired: order.depositRequired,
    amountPaid: order.amountPaid,
    amountDue: order.amountDue,
    onlineDue: nextSessionAmount(order),
    placedAt: order.placedAt,
    items,
    session: latest ? toSessionView(latest, order.code) : null,
    sessionUsable,
    reservedUntil,
    attempts: attempts.length,
  };
}

export type PaymentStatusSnapshot = {
  status: string;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  session: { status: string; expiresAt: string | null } | null;
};

/** Small payload for the result page's 3-second polling. */
export async function getPaymentStatusSnapshot(
  db: Reader,
  code: string,
): Promise<(PaymentStatusSnapshot & { userId: string | null }) | null> {
  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      amountPaid: orders.amountPaid,
    })
    .from(orders)
    .where(eq(orders.code, code))
    .limit(1);
  if (!order) return null;
  const [latest] = await db
    .select({ status: payments.status, expiresAt: payments.expiresAt })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), inArray(payments.provider, ['vnpay', 'payos'])))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return {
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus as PaymentStatus,
    amountPaid: order.amountPaid,
    session: latest
      ? { status: latest.status, expiresAt: latest.expiresAt?.toISOString() ?? null }
      : null,
  };
}

// ---------- Admin ----------

export type ListPage = { page: number; pageSize: number };
const offset = ({ page, pageSize }: ListPage) => (page - 1) * pageSize;

export type PaymentListRow = {
  id: string;
  orderId: string;
  orderCode: string;
  provider: string;
  kind: string;
  amount: number;
  status: string;
  txnRef: string;
  providerTxnId: string | null;
  bankCode: string | null;
  createdAt: Date;
  paidAt: Date | null;
  confirmedByName: string | null;
};

export async function listPayments(
  db: Reader,
  query: ListPage & { q?: string; provider?: string | null; status?: string | null },
): Promise<{ rows: PaymentListRow[]; total: number } & ListPage> {
  const filters: (SQL | undefined)[] = [
    query.provider ? eq(payments.provider, query.provider as 'vnpay') : undefined,
    query.status ? eq(payments.status, query.status as 'pending') : undefined,
    query.q
      ? or(
          ilike(orders.code, `%${query.q}%`),
          eq(payments.txnRef, query.q),
          eq(payments.providerTxnId, query.q),
        )
      : undefined,
  ];
  const where = and(...filters);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        orderCode: orders.code,
        provider: payments.provider,
        kind: payments.kind,
        amount: payments.amount,
        status: payments.status,
        txnRef: payments.txnRef,
        providerTxnId: payments.providerTxnId,
        bankCode: payments.bankCode,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
        confirmedByName: users.name,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(users, eq(users.id, payments.confirmedBy))
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(query.pageSize)
      .offset(offset(query)),
    db
      .select({ n: count() })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(where),
  ]);
  return { rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

export type PaymentEventRow = {
  id: string;
  provider: string;
  eventType: string;
  signatureValid: boolean;
  error: string | null;
  processedAt: Date | null;
  createdAt: Date;
  txnRef: string | null;
  orderCode: string | null;
  payload: unknown;
};

/** Webhook log; `invalid` = bad signature, `unmatched` = any processing error. */
export async function listPaymentEvents(
  db: Reader,
  query: ListPage & { filter: 'all' | 'invalid' | 'unmatched' },
): Promise<{ rows: PaymentEventRow[]; total: number } & ListPage> {
  const where =
    query.filter === 'invalid'
      ? eq(paymentEvents.signatureValid, false)
      : query.filter === 'unmatched'
        ? and(eq(paymentEvents.signatureValid, true), isNotNull(paymentEvents.error))
        : undefined;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: paymentEvents.id,
        provider: paymentEvents.provider,
        eventType: paymentEvents.eventType,
        signatureValid: paymentEvents.signatureValid,
        error: paymentEvents.error,
        processedAt: paymentEvents.processedAt,
        createdAt: paymentEvents.createdAt,
        txnRef: payments.txnRef,
        orderCode: orders.code,
        payload: paymentEvents.payload,
      })
      .from(paymentEvents)
      .leftJoin(payments, eq(payments.id, paymentEvents.paymentId))
      .leftJoin(orders, eq(orders.id, payments.orderId))
      .where(where)
      .orderBy(desc(paymentEvents.createdAt))
      .limit(query.pageSize)
      .offset(offset(query)),
    db.select({ n: count() }).from(paymentEvents).where(where),
  ]);
  return { rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

export type RefundRow = {
  id: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  amount: number;
  reason: string;
  method: string;
  status: string;
  providerRef: string | null;
  proofUrl: string | null;
  paymentProvider: string | null;
  paymentTxnRef: string | null;
  createdAt: Date;
  completedAt: Date | null;
  actorName: string | null;
};

export async function listRefunds(
  db: Reader,
  query: ListPage & { filter: 'open' | 'completed' | 'all' },
): Promise<{ rows: RefundRow[]; total: number } & ListPage> {
  const where =
    query.filter === 'open'
      ? inArray(refunds.status, ['requested', 'processing', 'failed'])
      : query.filter === 'completed'
        ? eq(refunds.status, 'completed')
        : undefined;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: refunds.id,
        orderId: refunds.orderId,
        orderCode: orders.code,
        orderStatus: orders.status,
        amount: refunds.amount,
        reason: refunds.reason,
        method: refunds.method,
        status: refunds.status,
        providerRef: refunds.providerRef,
        proofUrl: media.url,
        paymentProvider: payments.provider,
        paymentTxnRef: payments.txnRef,
        createdAt: refunds.createdAt,
        completedAt: refunds.completedAt,
        actorName: users.name,
      })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .leftJoin(payments, eq(payments.id, refunds.paymentId))
      .leftJoin(media, eq(media.id, refunds.proofMediaId))
      .leftJoin(users, eq(users.id, refunds.actorId))
      .where(where)
      .orderBy(asc(refunds.createdAt))
      .limit(query.pageSize)
      .offset(offset(query)),
    db.select({ n: count() }).from(refunds).where(where),
  ]);
  return { rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

export type BankTransferOrderRow = {
  orderId: string;
  code: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  placedAt: Date;
};

/** Orders waiting for a manual bank transfer (or found by code for any open order). */
export async function listBankTransferOrders(
  db: Reader,
  query: { q?: string; limit?: number },
): Promise<BankTransferOrderRow[]> {
  const open = and(
    sql`${orders.amountDue} > 0`,
    inArray(orders.status, [
      'pending',
      'awaiting_confirmation',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
    ]),
  );
  const where = query.q
    ? and(open, ilike(orders.code, `%${query.q}%`))
    : and(open, eq(orders.paymentMethod, 'bank_transfer'));
  return db
    .select({
      orderId: orders.id,
      code: orders.code,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      amountPaid: orders.amountPaid,
      amountDue: orders.amountDue,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(where)
    .orderBy(asc(orders.placedAt))
    .limit(query.limit ?? 50);
}

export type CodCandidateRow = {
  orderId: string;
  code: string;
  status: string;
  carrier: string | null;
  trackingCode: string | null;
  amountDue: number;
  deliveredAt: Date | null;
};

/** Delivered COD orders not yet in a remittance, optionally for one carrier. */
export async function listCodRemittanceCandidates(
  db: Reader,
  query: { carrier?: string | null; limit?: number } = {},
): Promise<CodCandidateRow[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      code: orders.code,
      status: orders.status,
      carrier: shipments.carrier,
      trackingCode: shipments.trackingCode,
      amountDue: orders.amountDue,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .leftJoin(codRemittanceOrders, eq(codRemittanceOrders.orderId, orders.id))
    .where(
      and(
        eq(orders.paymentMethod, 'cod'),
        inArray(orders.status, ['delivered', 'completed', 'return_requested']),
        sql`${orders.amountDue} > 0`,
        isNull(codRemittanceOrders.orderId),
        query.carrier ? eq(shipments.carrier, query.carrier as 'ghn') : undefined,
      ),
    )
    .orderBy(asc(orders.deliveredAt))
    .limit(query.limit ?? 200);
  // One row per order (several shipments: keep the first).
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.orderId) && seen.add(row.orderId));
}

export type CodRemittanceRow = {
  id: string;
  carrier: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  carrierFee: number;
  receivedAt: Date;
  bankReference: string | null;
  orderCount: number;
  ordersAmount: number;
  createdByName: string | null;
};

export async function listCodRemittances(
  db: Reader,
  query: ListPage,
): Promise<{ rows: CodRemittanceRow[]; total: number } & ListPage> {
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: codRemittances.id,
        carrier: codRemittances.carrier,
        periodStart: codRemittances.periodStart,
        periodEnd: codRemittances.periodEnd,
        totalAmount: codRemittances.totalAmount,
        carrierFee: codRemittances.carrierFee,
        receivedAt: codRemittances.receivedAt,
        bankReference: codRemittances.bankReference,
        orderCount: sql<number>`count(${codRemittanceOrders.orderId})::int`,
        ordersAmount: sql<number>`coalesce(sum(${codRemittanceOrders.amount}), 0)::bigint`.mapWith(
          Number,
        ),
        createdByName: users.name,
      })
      .from(codRemittances)
      .leftJoin(codRemittanceOrders, eq(codRemittanceOrders.remittanceId, codRemittances.id))
      .leftJoin(users, eq(users.id, codRemittances.createdBy))
      .groupBy(codRemittances.id, users.name)
      .orderBy(desc(codRemittances.receivedAt))
      .limit(query.pageSize)
      .offset(offset(query)),
    db.select({ n: count() }).from(codRemittances),
  ]);
  return { rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

/** Counters for the payments overview header. */
export async function getPaymentOverview(db: Reader) {
  const [[openRefunds], [suspicious], [awaitingTransfer]] = await Promise.all([
    db
      .select({ n: count() })
      .from(refunds)
      .where(inArray(refunds.status, ['requested', 'processing', 'failed'])),
    db
      .select({ n: count() })
      .from(paymentEvents)
      .where(or(eq(paymentEvents.signatureValid, false), isNotNull(paymentEvents.error))),
    db
      .select({ n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.paymentMethod, 'bank_transfer'),
          sql`${orders.amountDue} > 0`,
          inArray(orders.status, ['pending', 'awaiting_confirmation', 'confirmed']),
        ),
      ),
  ]);
  return {
    openRefunds: openRefunds?.n ?? 0,
    suspiciousEvents: suspicious?.n ?? 0,
    awaitingBankTransfer: awaitingTransfer?.n ?? 0,
  };
}
