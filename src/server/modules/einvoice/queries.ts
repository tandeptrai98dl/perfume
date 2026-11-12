import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderEvents, orders } from '@/server/db/schema';
import { einvoiceLookupUrl } from '@/server/integrations/einvoice';

import { einvoiceAdjustmentEvents } from './adjustments';
import { einvoiceEvents } from './service';
import {
  EINVOICE_ADJUSTMENT_EVENTS,
  EINVOICE_EVENT_TYPES,
  EINVOICE_EVENTS,
  einvoiceAdjustmentStatus,
  einvoiceStatus,
  type EinvoiceAdjustmentSummary,
  type EinvoiceState,
} from './state';

/** Read models for the admin order detail (EInvoiceStatus) and the failed-invoice list. */

export type IssuedEinvoiceView = {
  ref: string;
  issuedAt: Date | null;
  provider: string | null;
  invoiceNo: string | null;
  series: string | null;
  templateCode: string | null;
  transactionId: string | null;
  lookupCode: string | null;
  lookupUrl: string | null;
  buyer: 'company' | 'individual' | null;
};

export type OrderEinvoiceView = {
  orderId: string;
  /** Cancellation / replacement after issuing (returns, corrections). */
  adjustment: EinvoiceAdjustmentSummary;
  state: EinvoiceState;
  attempts: number;
  reason: string | null;
  lastEventAt: Date | null;
  canRetry: boolean;
  /** Company invoice requested at checkout (`orders.vat_invoice`). */
  company: boolean;
  invoice: IssuedEinvoiceView | null;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export async function getOrderEinvoice(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<OrderEinvoiceView | null> {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      deliveredAt: orders.deliveredAt,
      einvoiceRef: orders.einvoiceRef,
      einvoiceIssuedAt: orders.einvoiceIssuedAt,
      vatInvoice: orders.vatInvoice,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const [events, adjustments] = await Promise.all([
    einvoiceEvents(db, orderId),
    einvoiceAdjustmentEvents(db, orderId),
  ]);
  const status = einvoiceStatus(order, events);
  const adjustment = einvoiceAdjustmentStatus(order, adjustments);
  let invoice: IssuedEinvoiceView | null = null;
  if (order.einvoiceRef) {
    // The standing invoice: the latest replacement, else the original.
    const meta =
      adjustments.findLast((e) => e.type === EINVOICE_ADJUSTMENT_EVENTS.replaced)?.metadata ??
      events.findLast((e) => e.type === EINVOICE_EVENTS.issued)?.metadata ??
      {};
    const provider = str(meta.provider);
    const lookupCode = str(meta.lookupCode);
    const buyer = meta.buyer === 'company' || meta.buyer === 'individual' ? meta.buyer : null;
    invoice = {
      ref: order.einvoiceRef,
      issuedAt: order.einvoiceIssuedAt,
      provider,
      invoiceNo: str(meta.invoiceNo),
      series: str(meta.series),
      templateCode: str(meta.templateCode),
      transactionId: str(meta.transactionId),
      lookupCode,
      lookupUrl: einvoiceLookupUrl(provider, lookupCode),
      buyer,
    };
  }
  return {
    orderId: order.id,
    ...status,
    adjustment,
    company: order.vatInvoice != null,
    invoice,
  };
}

export type FailedEinvoiceRow = {
  orderId: string;
  code: string;
  status: string;
  total: number;
  deliveredAt: Date | null;
  reason: string | null;
  attempts: number | null;
  failedAt: Date;
};

/** Orders without an invoice whose latest e-invoice event is a final failure. */
function failedOrdersQuery(db: Pick<Database, 'selectDistinctOn'>) {
  const latest = db
    .selectDistinctOn([orderEvents.orderId], {
      orderId: orderEvents.orderId,
      type: orderEvents.type,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(inArray(orderEvents.type, [...EINVOICE_EVENT_TYPES]))
    .orderBy(orderEvents.orderId, desc(orderEvents.createdAt), desc(orderEvents.id))
    .as('latest');
  return { latest };
}

export async function listFailedEinvoices(
  db: Pick<Database, 'select' | 'selectDistinctOn'>,
  options: { limit?: number } = {},
): Promise<FailedEinvoiceRow[]> {
  const { latest } = failedOrdersQuery(db);
  const rows = await db
    .select({
      orderId: orders.id,
      code: orders.code,
      status: orders.status,
      total: orders.total,
      deliveredAt: orders.deliveredAt,
      metadata: latest.metadata,
      failedAt: latest.createdAt,
    })
    .from(latest)
    .innerJoin(orders, eq(orders.id, latest.orderId))
    .where(and(eq(latest.type, EINVOICE_EVENTS.failed), isNull(orders.einvoiceRef)))
    .orderBy(desc(latest.createdAt))
    .limit(options.limit ?? 200);
  return rows.map(({ metadata, ...row }) => {
    const meta = (metadata ?? {}) as Record<string, unknown>;
    return {
      ...row,
      reason: str(meta.reason),
      attempts: typeof meta.attempt === 'number' ? meta.attempt : null,
    };
  });
}

/** Dashboard KPI "e-invoices failed" (§11.2). */
export async function countFailedEinvoices(
  db: Pick<Database, 'select' | 'selectDistinctOn'>,
): Promise<number> {
  const { latest } = failedOrdersQuery(db);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(latest)
    .innerJoin(orders, eq(orders.id, latest.orderId))
    .where(and(eq(latest.type, EINVOICE_EVENTS.failed), isNull(orders.einvoiceRef)));
  return row?.count ?? 0;
}
