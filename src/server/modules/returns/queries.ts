import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderEvents, orderItems, orders } from '@/server/db/schema';
import {
  normalizeOrderCode,
  ORDER_CODE_PATTERN,
  parseReturnRequested,
  RETURN_EVENT_TYPES,
  RETURN_EVENTS,
  type ReturnReason,
  type ReturnResolution,
} from '@/server/modules/order';
import { getCommerceSettings } from '@/server/modules/settings';

import {
  defaultResellable,
  foldReturnEvents,
  planReturnRefund,
  resolutionsFor,
  returnEligibility,
  type ReturnIneligibility,
  type ReturnState,
} from './rules';
import { returnEvents } from './service';

/** Read models: the customer's return section, the admin return panel and queue. */

type Reader = Pick<Database, 'select'>;

/** Order id and owner by code, for the request action's access check. */
export async function findOrderForReturn(
  db: Reader,
  code: string,
): Promise<{ id: string; code: string; userId: string | null } | null> {
  const normalized = normalizeOrderCode(code);
  if (!ORDER_CODE_PATTERN.test(normalized)) return null;
  const [row] = await db
    .select({ id: orders.id, code: orders.code, userId: orders.userId })
    .from(orders)
    .where(eq(orders.code, normalized))
    .limit(1);
  return row ?? null;
}

export type CustomerReturnView = {
  /** The customer may file a request now. */
  canRequest: boolean;
  ineligibility: ReturnIneligibility | null;
  deadline: Date | null;
  windowDays: number;
  request:
    | (Pick<
        ReturnState,
        | 'status'
        | 'reason'
        | 'resolution'
        | 'lines'
        | 'requestedAt'
        | 'approvalNote'
        | 'rejectionReason'
        | 'outcome'
      > & { refundTotal: number | null; photoCount: number })
    | null;
};

/** What the order page shows about returns (members and guests with access). */
export async function getCustomerReturnView(
  db: Reader,
  order: { id: string; status: string },
  now = new Date(),
): Promise<CustomerReturnView> {
  const [settings, events, [row]] = await Promise.all([
    getCommerceSettings(db),
    returnEvents(db, order.id),
    db.select({ deliveredAt: orders.deliveredAt }).from(orders).where(eq(orders.id, order.id)),
  ]);
  const state = foldReturnEvents(events);
  const eligibility = returnEligibility({
    status: order.status,
    deliveredAt: row?.deliveredAt ?? null,
    windowDays: settings.returnsWindowDays,
    now,
    latest: state?.status ?? null,
  });
  return {
    canRequest: eligibility.eligible,
    ineligibility: eligibility.eligible ? null : eligibility.reason,
    deadline: eligibility.deadline,
    windowDays: settings.returnsWindowDays,
    request: state && {
      status: state.status,
      reason: state.reason,
      resolution: state.resolution,
      lines: state.lines,
      requestedAt: state.requestedAt,
      approvalNote: state.approvalNote,
      rejectionReason: state.rejectionReason,
      outcome: state.outcome,
      refundTotal: state.refund?.total ?? null,
      photoCount: state.photos.length,
    },
  };
}

export type AdminReturnLine = {
  orderItemId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  bought: number;
  quantity: number;
};

export type AdminReturnPhoto = { id: string; width: number; height: number; url: string };

/** Staff-only URL of a return photo (authenticated Route Handler, never public). */
export function adminReturnPhotoUrl(orderId: string, photoId: string): string {
  return `/api/admin/orders/${orderId}/return-photos/${photoId}`;
}

export type AdminReturnView = Omit<ReturnState, 'photos'> & {
  photos: AdminReturnPhoto[];
  orderId: string;
  items: AdminReturnLine[];
  /** Refund the parcel would queue (without a return-shipping reimbursement). */
  estimate: ReturnType<typeof planReturnRefund>;
  /** Money the order holds that can still be refunded. */
  refundable: number;
  fault: boolean;
  resolutions: ReturnResolution[];
  defaultResellable: boolean;
};

/** The order's return request with its lines and the refund preview (admin order page). */
export async function getAdminReturn(db: Reader, orderId: string): Promise<AdminReturnView | null> {
  const [order] = await db
    .select({
      id: orders.id,
      shippingFee: orders.shippingFee,
      giftWrapFee: orders.giftWrapFee,
      amountPaid: orders.amountPaid,
      amountRefunded: orders.amountRefunded,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const state = foldReturnEvents(await returnEvents(db, orderId));
  if (!state) return null;
  const items = await db
    .select({
      id: orderItems.id,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      sku: orderItems.sku,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const lines = state.lines.filter((line) => items.some((item) => item.id === line.orderItemId));
  const estimate = planReturnRefund({
    items,
    lines,
    reason: state.reason,
    resolution: state.resolution,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
  });
  return {
    ...state,
    photos: state.photos.map((photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      url: adminReturnPhotoUrl(orderId, photo.id),
    })),
    orderId,
    items: lines.map((line) => {
      const item = items.find((candidate) => candidate.id === line.orderItemId)!;
      return {
        orderItemId: item.id,
        productName: item.productName,
        variantLabel: item.variantLabel,
        sku: item.sku,
        bought: item.quantity,
        quantity: line.quantity,
      };
    }),
    estimate,
    refundable: Math.max(0, order.amountPaid - order.amountRefunded),
    fault: state.reason !== 'unopened',
    resolutions: resolutionsFor(state.reason),
    defaultResellable: defaultResellable(state.reason),
  };
}

export type ReturnQueueRow = {
  orderId: string;
  code: string;
  total: number;
  paymentMethod: string;
  deliveredAt: Date | null;
  requestedAt: Date;
  status: 'requested' | 'approved';
  reason: ReturnReason;
  resolution: ReturnResolution;
  units: number;
  estimatedRefund: number;
};

/** Orders waiting in `return_requested`, oldest request first (§11.2 work queue). */
export async function listReturnQueue(db: Reader, options: { limit?: number } = {}) {
  const pending = await db
    .select({
      id: orders.id,
      code: orders.code,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      deliveredAt: orders.deliveredAt,
      shippingFee: orders.shippingFee,
      giftWrapFee: orders.giftWrapFee,
    })
    .from(orders)
    .where(eq(orders.status, 'return_requested'))
    .orderBy(desc(orders.updatedAt))
    .limit(options.limit ?? 200);
  if (pending.length === 0) return [];
  const ids = pending.map((order) => order.id);
  const [events, items] = await Promise.all([
    db
      .select({
        id: orderEvents.id,
        orderId: orderEvents.orderId,
        type: orderEvents.type,
        message: orderEvents.message,
        metadata: orderEvents.metadata,
        createdAt: orderEvents.createdAt,
      })
      .from(orderEvents)
      .where(
        and(inArray(orderEvents.orderId, ids), inArray(orderEvents.type, [...RETURN_EVENT_TYPES])),
      )
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
    db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids)),
  ]);
  const rows: ReturnQueueRow[] = [];
  for (const order of pending) {
    const state = foldReturnEvents(events.filter((event) => event.orderId === order.id));
    if (!state || (state.status !== 'requested' && state.status !== 'approved')) continue;
    const lines = items.filter((item) => item.orderId === order.id);
    const known = state.lines.filter((line) => lines.some((item) => item.id === line.orderItemId));
    rows.push({
      orderId: order.id,
      code: order.code,
      total: order.total,
      paymentMethod: order.paymentMethod,
      deliveredAt: order.deliveredAt,
      requestedAt: state.requestedAt,
      status: state.status,
      reason: state.reason,
      resolution: state.resolution,
      units: state.lines.reduce((sum, line) => sum + line.quantity, 0),
      estimatedRefund: planReturnRefund({
        items: lines,
        lines: known,
        reason: state.reason,
        resolution: state.resolution,
        shippingFee: order.shippingFee,
        giftWrapFee: order.giftWrapFee,
      }).total,
    });
  }
  return rows.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

/** Badge count for the admin navigation / dashboard. */
export async function countReturnQueue(db: Reader): Promise<number> {
  return (await listReturnQueue(db)).length;
}

/**
 * Private photo of one of the order's return requests (any request, also a rejected one), for
 * the staff-only route. The key comes from the order timeline, never from the URL.
 */
export async function findReturnPhoto(
  db: Reader,
  orderId: string,
  photoId: string,
): Promise<{ key: string; mime: string } | null> {
  for (const event of await returnEvents(db, orderId)) {
    if (event.type !== RETURN_EVENTS.requested) continue;
    const photo = parseReturnRequested(event.metadata)?.photos.find((p) => p.id === photoId);
    if (photo) return { key: photo.key, mime: photo.mime };
  }
  return null;
}

export type StaffReturnOptions = {
  /** The order can take a new request now (status, open request, window). */
  canOpen: boolean;
  /** Only with the manager's window override. */
  needsOverride: boolean;
  ineligibility: ReturnIneligibility | null;
  deadline: Date | null;
  items: Array<{ id: string; productName: string; variantLabel: string; quantity: number }>;
};

/** What the admin order page offers for opening a return on the customer's behalf. */
export async function getStaffReturnOptions(
  db: Reader,
  orderId: string,
  now = new Date(),
): Promise<StaffReturnOptions | null> {
  const [order] = await db
    .select({ status: orders.status, deliveredAt: orders.deliveredAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || (order.status !== 'delivered' && order.status !== 'completed')) return null;
  const [settings, events, items] = await Promise.all([
    getCommerceSettings(db),
    returnEvents(db, orderId),
    db
      .select({
        id: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
  ]);
  const input = {
    status: order.status,
    deliveredAt: order.deliveredAt,
    windowDays: settings.returnsWindowDays,
    now,
    latest: foldReturnEvents(events)?.status ?? null,
  };
  const plain = returnEligibility(input);
  const overridden = returnEligibility({ ...input, overrideWindow: true });
  return {
    canOpen: overridden.eligible,
    needsOverride: !plain.eligible && overridden.eligible,
    ineligibility: plain.eligible ? null : plain.reason,
    deadline: plain.deadline,
    items,
  };
}
