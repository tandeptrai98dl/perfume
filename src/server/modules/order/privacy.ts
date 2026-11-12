import { and, asc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderEvents, orderItems, orders } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

import { ORDER_STATUSES, isTerminal, type OrderStatus } from './state-machine';

/*
 * Personal data held by the order module, for data-subject requests (PDPL 91/2025, privacy
 * centre §10.6, privacy requests §11.2). Called by the customer module; only this module writes
 * the order tables. Accounting data (codes, dates, items, prices, totals, payment state, VAT
 * company details) is kept; contact details and free text are removed.
 */

type Reader = Pick<Database, 'select'>;

export type OrderSubject = { userId: string | null; email: string };

/** Placeholder written over removed names and streets (DB content, not UI text). */
export const ANONYMIZED_TEXT = '[anonymized]';
const ADDRESS_PII_FIELDS = ['fullName', 'phone', 'street', 'legacyDistrict'] as const;

/** Statuses after which an order no longer needs the customer's contact details. */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(isTerminal);

function subjectWhere(subject: OrderSubject): SQL {
  const byEmail = eq(orders.email, subject.email);
  return subject.userId ? or(eq(orders.userId, subject.userId), byEmail)! : byEmail;
}

/** Orders still in progress (deletion waits until they are closed). */
export async function countOpenOrdersForSubject(
  db: Reader,
  subject: OrderSubject,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(subjectWhere(subject), notInArray(orders.status, [...CLOSED_ORDER_STATUSES])));
  return row?.n ?? 0;
}

export type OrderDataExport = {
  code: string;
  placedAt: string;
  locale: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  contact: { name: string; email: string; phone: string };
  items: {
    productName: string;
    variantLabel: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  totals: {
    subtotal: number;
    discountTotal: number;
    shippingFee: number;
    giftWrapFee: number;
    total: number;
    amountPaid: number;
    amountRefunded: number;
  };
  couponCode: string | null;
  giftMessage: string | null;
  customerNote: string | null;
  vatInvoice: unknown;
  addresses: {
    type: string;
    fullName: string;
    phone: string;
    street: string;
    wardName: string;
    provinceName: string;
  }[];
};

/** The subject's orders as they appear in the personal-data export (no internal notes). */
export async function listOrdersForDataExport(
  db: Reader,
  subject: OrderSubject,
): Promise<OrderDataExport[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(subjectWhere(subject))
    .orderBy(asc(orders.placedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [items, addresses] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids))
      .orderBy(asc(orderItems.id)),
    db.select().from(orderAddresses).where(inArray(orderAddresses.orderId, ids)),
  ]);
  return rows.map((order) => ({
    code: order.code,
    placedAt: order.placedAt.toISOString(),
    locale: order.locale,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    contact: { name: order.customerName, email: order.email, phone: order.phone },
    items: items
      .filter((item) => item.orderId === order.id)
      .map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    totals: {
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingFee: order.shippingFee,
      giftWrapFee: order.giftWrapFee,
      total: order.total,
      amountPaid: order.amountPaid,
      amountRefunded: order.amountRefunded,
    },
    couponCode: order.couponCode,
    giftMessage: order.giftMessage,
    customerNote: order.customerNote,
    vatInvoice: order.vatInvoice,
    addresses: addresses
      .filter((address) => address.orderId === order.id)
      .map((address) => ({
        type: address.type,
        fullName: address.fullName,
        phone: address.phone,
        street: address.street,
        wardName: address.wardName,
        provinceName: address.provinceName,
      })),
  }));
}

/** Removes contact details from an `edited` event diff (`diff.address.<field>.from/to`). */
export function scrubEventDiff(diff: unknown): { diff: unknown; changed: boolean } {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return { diff, changed: false };
  const address = (diff as Record<string, unknown>).address;
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    return { diff, changed: false };
  }
  let changed = false;
  const scrubbed: Record<string, unknown> = { ...(address as Record<string, unknown>) };
  for (const field of ADDRESS_PII_FIELDS) {
    if (field in scrubbed) {
      scrubbed[field] = { from: ANONYMIZED_TEXT, to: ANONYMIZED_TEXT };
      changed = true;
    }
  }
  return changed ? { diff: { ...diff, address: scrubbed }, changed } : { diff, changed };
}

function withoutEmail(vatInvoice: unknown): unknown {
  if (!vatInvoice || typeof vatInvoice !== 'object' || Array.isArray(vatInvoice)) return vatInvoice;
  const rest: Record<string, unknown> = { ...(vatInvoice as Record<string, unknown>) };
  delete rest.email;
  return rest;
}

/**
 * Anonymises the subject's orders in the caller's transaction: contact details on the order and
 * its addresses, free text (customer note, gift message), IP / user agent, the e-mail on the
 * VAT details and contact fields inside `edited` event diffs. Totals, items, payments and the
 * VAT company details stay for accounting (Accounting Law: 10-year retention).
 * Returns the number of orders changed. Callers check `countOpenOrdersForSubject` first.
 */
export async function anonymizeOrdersForSubject(tx: Tx, subject: OrderSubject): Promise<number> {
  const rows = await tx
    .select({ id: orders.id, vatInvoice: orders.vatInvoice })
    .from(orders)
    .where(subjectWhere(subject))
    .for('update');
  if (rows.length === 0) return 0;
  const ids = rows.map((row) => row.id);

  for (const row of rows) {
    await tx
      .update(orders)
      .set({
        email: `anonymized+${row.id}@anonymized.invalid`,
        phone: '',
        customerName: ANONYMIZED_TEXT,
        customerNote: null,
        giftMessage: null,
        ipAddress: null,
        userAgent: null,
        vatInvoice: withoutEmail(row.vatInvoice) ?? null,
      })
      .where(eq(orders.id, row.id));
  }
  await tx
    .update(orderAddresses)
    .set({ fullName: ANONYMIZED_TEXT, phone: '', street: ANONYMIZED_TEXT, legacyDistrict: null })
    .where(inArray(orderAddresses.orderId, ids));

  // Order edits keep a before/after address diff (M2): scrub it as well.
  const events = await tx
    .select({ id: orderEvents.id, diff: orderEvents.diff })
    .from(orderEvents)
    .where(and(inArray(orderEvents.orderId, ids), sql`${orderEvents.diff} ? 'address'`));
  for (const event of events) {
    const { diff, changed } = scrubEventDiff(event.diff);
    if (changed) await tx.update(orderEvents).set({ diff }).where(eq(orderEvents.id, event.id));
  }
  return rows.length;
}
