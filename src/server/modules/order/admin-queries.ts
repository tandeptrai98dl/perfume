import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  orderAddresses,
  orderEvents,
  orderItems,
  orders,
  payments,
  refunds,
  users,
} from '@/server/db/schema';
import { containsPattern, foldedContains, pageOffset, type Paged } from '@/server/lib/sql-helpers';
import {
  latestShipmentsForOrders,
  listShipmentsForOrder,
  type AdminShipment,
} from '@/server/modules/shipping';

import {
  dateRangeBounds,
  ORDER_TABS,
  type OrderListQuery,
  type OrderSort,
  type OrderTab,
  type PaymentMethod,
  type PaymentStatus,
} from './admin-schemas';
import {
  contactView,
  orderMoneySummary,
  packingSlipView,
  partialPhone,
  staffNextStatuses,
  type ContactView,
  type OrderMoneySummary,
} from './admin-view';
import { ORDER_STATUSES, type OrderStatus } from './state-machine';

/*
 * Admin read side for orders (§11.2): list with filters and work-queue counts, detail with
 * timeline/payments/shipments, print data and dashboard figures. Contact details are masked
 * here (server side) for roles without the contact permission, so they never reach the client.
 */

type Reader = Pick<Database, 'select'>;

export type AdminOrderRow = {
  id: string;
  code: string;
  version: number;
  placedAt: Date;
  customerName: string;
  phone: string;
  email: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  total: number;
  amountDue: number;
  depositRequired: number;
  amountPaid: number;
  provinceName: string | null;
  itemCount: number;
  codRisk: boolean;
};

const shippingAddress = aliasedTable(orderAddresses, 'shipping_address');

function listWhere(query: OrderListQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (query.tab) conditions.push(inArray(orders.status, [...ORDER_TABS[query.tab]]));
  if (query.status) conditions.push(eq(orders.status, query.status));
  if (query.paymentStatus) conditions.push(eq(orders.paymentStatus, query.paymentStatus));
  if (query.paymentMethod) conditions.push(eq(orders.paymentMethod, query.paymentMethod));
  if (query.province) conditions.push(eq(shippingAddress.provinceCode, query.province));
  const { start, end } = dateRangeBounds(query);
  if (start) conditions.push(gte(orders.placedAt, start));
  if (end) conditions.push(lt(orders.placedAt, end));
  const q = query.q.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    conditions.push(
      or(
        sql`${orders.code} ilike ${containsPattern(q)}`,
        sql`${orders.email} ilike ${containsPattern(q)}`,
        foldedContains(orders.customerName, q),
        digits.length >= 3
          ? sql`regexp_replace(${orders.phone}, '\\D', '', 'g') like ${containsPattern(digits)}`
          : undefined,
      ),
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

function listOrder(sort: string, dir: 'asc' | 'desc'): SQL[] {
  const direction = dir === 'asc' ? asc : desc;
  switch (sort as OrderSort) {
    case 'total':
      return [direction(orders.total), desc(orders.placedAt)];
    case 'code':
      return [direction(orders.code)];
    default:
      return [direction(orders.placedAt), desc(orders.id)];
  }
}

const itemCount = sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)::int from ${orderItems} where ${orderItems.orderId} = ${sql.raw('"orders"."id"')})`;

export async function listAdminOrders(
  db: Reader,
  query: OrderListQuery,
  role: string,
): Promise<Paged<AdminOrderRow>> {
  const where = listWhere(query);
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      version: orders.version,
      placedAt: orders.placedAt,
      customerName: orders.customerName,
      phone: orders.phone,
      email: orders.email,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      amountDue: orders.amountDue,
      depositRequired: orders.depositRequired,
      amountPaid: orders.amountPaid,
      provinceName: shippingAddress.provinceName,
      itemCount: itemCount.mapWith(Number),
      codRisk: sql<boolean>`coalesce(${users.codRiskFlag}, false)`.mapWith(Boolean),
    })
    .from(orders)
    .leftJoin(
      shippingAddress,
      and(eq(shippingAddress.orderId, orders.id), eq(shippingAddress.type, 'shipping')),
    )
    .leftJoin(users, eq(users.id, orders.userId))
    .where(where)
    .orderBy(...listOrder(query.sort, query.dir))
    .limit(query.pageSize)
    .offset(pageOffset(query.page, query.pageSize));
  const [totalRow] = await db
    .select({ total: count() })
    .from(orders)
    .leftJoin(
      shippingAddress,
      and(eq(shippingAddress.orderId, orders.id), eq(shippingAddress.type, 'shipping')),
    )
    .where(where);
  return {
    rows: rows.map((row) => ({ ...row, ...maskedContact(row, role) })),
    total: totalRow?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function maskedContact(contact: { phone: string; email: string }, role: string) {
  const view = contactView(contact, role);
  return { phone: view.phone, email: view.email };
}

export type OrderStatusCounts = Record<OrderStatus, number>;

export async function countOrdersByStatus(db: Reader): Promise<OrderStatusCounts> {
  const rows = await db
    .select({ status: orders.status, n: count() })
    .from(orders)
    .groupBy(orders.status);
  const counts = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0]),
  ) as OrderStatusCounts;
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

export function tabCounts(counts: OrderStatusCounts): Record<OrderTab, number> {
  return Object.fromEntries(
    (Object.keys(ORDER_TABS) as OrderTab[]).map((tab) => [
      tab,
      ORDER_TABS[tab].reduce((sum, status) => sum + counts[status], 0),
    ]),
  ) as Record<OrderTab, number>;
}

export type CodRisk = {
  /** The customer account carries `users.cod_risk_flag`. */
  accountFlagged: boolean;
  /** Other orders to the same phone that ended in a failed delivery. */
  failedDeliveries: number;
};

/**
 * COD risk for a phone (D16: "phone numbers with failed deliveries are flagged"): failed
 * deliveries recorded on other orders with this phone, or a flagged account with this phone.
 * Shared by the admin detail page and, later, checkout/staff alerts for new COD orders.
 */
export async function codRiskForPhone(
  db: Reader,
  phone: string,
  options: { excludeOrderId?: string; userId?: string | null } = {},
): Promise<CodRisk> {
  const [failed] = await db
    .select({ n: sql<number>`count(distinct ${orders.id})::int` })
    .from(orders)
    .innerJoin(orderEvents, eq(orderEvents.orderId, orders.id))
    .where(
      and(
        eq(orders.phone, phone),
        eq(orderEvents.toStatus, 'delivery_failed'),
        options.excludeOrderId ? ne(orders.id, options.excludeOrderId) : undefined,
      ),
    );
  const [flagged] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.codRiskFlag, true),
        options.userId
          ? or(eq(users.phone, phone), eq(users.id, options.userId))
          : eq(users.phone, phone),
      ),
    );
  return { accountFlagged: (flagged?.n ?? 0) > 0, failedDeliveries: failed?.n ?? 0 };
}

export type AdminOrderEvent = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string | null;
  actorType: 'system' | 'customer' | 'staff';
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type AdminOrderPayment = {
  id: string;
  provider: string;
  kind: string;
  amount: number;
  status: string;
  txnRef: string;
  paidAt: Date | null;
  createdAt: Date;
};

export type AdminOrderRefund = {
  id: string;
  amount: number;
  method: string;
  status: string;
  reason: string;
  createdAt: Date;
};

export type AdminOrderAddress = {
  fullName: string;
  phone: string;
  street: string;
  wardName: string;
  legacyDistrict: string | null;
  provinceName: string;
  provinceCode: string;
};

export type VatInvoice = {
  companyName?: string;
  taxCode?: string;
  address?: string;
  email?: string;
};

export type AdminOrderDetail = {
  id: string;
  code: string;
  version: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  source: 'web' | 'admin';
  locale: 'vi' | 'en';
  customerName: string;
  contact: ContactView;
  userId: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  couponCode: string | null;
  giftWrap: boolean;
  giftMessage: string | null;
  hidePrices: boolean;
  customerNote: string | null;
  vatInvoice: VatInvoice | null;
  einvoiceRef: string | null;
  money: OrderMoneySummary;
  items: {
    id: string;
    productId: string;
    sku: string;
    productName: string;
    variantLabel: string;
    imageUrl: string | null;
    unitPrice: number;
    compareAtPrice: number | null;
    quantity: number;
    discountAllocated: number;
    lineTotal: number;
  }[];
  shippingAddress: AdminOrderAddress | null;
  billingAddress: AdminOrderAddress | null;
  payments: AdminOrderPayment[];
  refunds: AdminOrderRefund[];
  shipments: AdminShipment[];
  events: AdminOrderEvent[];
  codRisk: CodRisk;
  /** Transition buttons allowed for the viewer's role. */
  nextStatuses: OrderStatus[];
};

function addressView(
  row: typeof orderAddresses.$inferSelect | undefined,
  masked: boolean,
): AdminOrderAddress | null {
  if (!row) return null;
  return {
    fullName: row.fullName,
    phone: masked ? partialPhone(row.phone) : row.phone,
    street: row.street,
    wardName: row.wardName,
    legacyDistrict: row.legacyDistrict,
    provinceName: row.provinceName,
    provinceCode: row.provinceCode,
  };
}

function vatInvoiceView(value: unknown): VatInvoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined);
  const view = {
    companyName: text('companyName'),
    taxCode: text('taxCode'),
    address: text('address'),
    email: text('email'),
  };
  return Object.values(view).some(Boolean) ? view : null;
}

export async function getAdminOrderDetail(
  db: Reader,
  id: string,
  role: string,
): Promise<AdminOrderDetail | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return null;
  const actorUser = aliasedTable(users, 'actor_user');
  const [items, addresses, paymentRows, refundRows, shipmentRows, events, codRisk] =
    await Promise.all([
      db
        .select({
          id: orderItems.id,
          productId: orderItems.productId,
          sku: orderItems.sku,
          productName: orderItems.productName,
          variantLabel: orderItems.variantLabel,
          imageUrl: orderItems.imageUrl,
          unitPrice: orderItems.unitPrice,
          compareAtPrice: orderItems.compareAtPrice,
          quantity: orderItems.quantity,
          discountAllocated: orderItems.discountAllocated,
          lineTotal: orderItems.lineTotal,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, id))
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
      db.select().from(orderAddresses).where(eq(orderAddresses.orderId, id)),
      db
        .select({
          id: payments.id,
          provider: payments.provider,
          kind: payments.kind,
          amount: payments.amount,
          status: payments.status,
          txnRef: payments.txnRef,
          paidAt: payments.paidAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .where(eq(payments.orderId, id))
        .orderBy(desc(payments.createdAt)),
      db
        .select({
          id: refunds.id,
          amount: refunds.amount,
          method: refunds.method,
          status: refunds.status,
          reason: refunds.reason,
          createdAt: refunds.createdAt,
        })
        .from(refunds)
        .where(eq(refunds.orderId, id))
        .orderBy(desc(refunds.createdAt)),
      listShipmentsForOrder(db, id),
      db
        .select({
          id: orderEvents.id,
          type: orderEvents.type,
          fromStatus: orderEvents.fromStatus,
          toStatus: orderEvents.toStatus,
          message: orderEvents.message,
          actorType: orderEvents.actorType,
          actorName: actorUser.name,
          metadata: orderEvents.metadata,
          createdAt: orderEvents.createdAt,
        })
        .from(orderEvents)
        .leftJoin(actorUser, eq(actorUser.id, orderEvents.actorId))
        .where(eq(orderEvents.orderId, id))
        .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id)),
      codRiskForPhone(db, order.phone, { excludeOrderId: id, userId: order.userId }),
    ]);

  const contact = contactView({ phone: order.phone, email: order.email }, role);
  const status = order.status as OrderStatus;
  return {
    id: order.id,
    code: order.code,
    version: order.version,
    status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    source: order.source,
    locale: order.locale,
    customerName: order.customerName,
    contact,
    userId: order.userId,
    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    giftWrapFee: order.giftWrapFee,
    total: order.total,
    amountPaid: order.amountPaid,
    amountRefunded: order.amountRefunded,
    couponCode: order.couponCode,
    giftWrap: order.giftWrap,
    giftMessage: order.giftMessage,
    hidePrices: order.hidePrices,
    customerNote: order.customerNote,
    vatInvoice: vatInvoiceView(order.vatInvoice),
    einvoiceRef: order.einvoiceRef,
    money: orderMoneySummary({ ...order, status }),
    items,
    shippingAddress: addressView(
      addresses.find((a) => a.type === 'shipping'),
      contact.masked,
    ),
    billingAddress: addressView(
      addresses.find((a) => a.type === 'billing'),
      contact.masked,
    ),
    payments: paymentRows,
    refunds: refundRows,
    shipments: shipmentRows,
    events: events.map((event) => ({
      ...event,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
    })),
    codRisk,
    nextStatuses: staffNextStatuses(status, role, order.amountPaid),
  };
}

export type PrintableOrder = {
  id: string;
  code: string;
  placedAt: Date;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  customerName: string;
  phone: string;
  giftWrap: boolean;
  giftMessage: string | null;
  customerNote: string | null;
  shippingAddress: AdminOrderAddress | null;
  shipment: AdminShipment | null;
  money: OrderMoneySummary;
  packingSlip: ReturnType<typeof packingSlipView>;
};

/**
 * Data for printed packing/delivery slips (one or many orders, in the given order). Staff need
 * the full phone and address to hand the parcel to the carrier; printing needs `orders.view`
 * plus the contact permission, checked by the page.
 */
export async function getPrintableOrders(
  db: Reader,
  ids: readonly string[],
): Promise<PrintableOrder[]> {
  if (ids.length === 0) return [];
  const orderRows = await db
    .select()
    .from(orders)
    .where(inArray(orders.id, [...ids]));
  if (orderRows.length === 0) return [];
  const found = orderRows.map((order) => order.id);
  const [items, addresses, shipmentMap] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, found))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    db
      .select()
      .from(orderAddresses)
      .where(and(inArray(orderAddresses.orderId, found), eq(orderAddresses.type, 'shipping'))),
    latestShipmentsForOrders(db, found),
  ]);
  const byId = new Map(orderRows.map((order) => [order.id, order]));
  return ids.flatMap((id) => {
    const order = byId.get(id);
    if (!order) return [];
    const status = order.status as OrderStatus;
    return [
      {
        id: order.id,
        code: order.code,
        placedAt: order.placedAt,
        status,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        phone: order.phone,
        giftWrap: order.giftWrap,
        giftMessage: order.giftMessage,
        customerNote: order.customerNote,
        shippingAddress: addressView(
          addresses.find((a) => a.orderId === id),
          false,
        ),
        shipment: shipmentMap.get(id) ?? null,
        money: orderMoneySummary({ ...order, status }),
        packingSlip: packingSlipView(
          order,
          items.filter((item) => item.orderId === id),
        ),
      },
    ];
  });
}

export type RevenueWindow = { revenue: number; orders: number; averageOrderValue: number };

export type RevenueStats = {
  today: RevenueWindow;
  last7Days: RevenueWindow;
  last30Days: RevenueWindow;
};

/** Statuses that do not count as sales (unconfirmed or undone). */
const NON_REVENUE: OrderStatus[] = ['pending', 'awaiting_confirmation', 'cancelled', 'returned'];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the Vietnam calendar day containing `now`, as a UTC instant. */
export function startOfVietnamDay(now: Date): Date {
  const vn = now.getTime() + VN_OFFSET_MS;
  return new Date(vn - (vn % DAY_MS) - VN_OFFSET_MS);
}

/**
 * Revenue (net of refunds) of confirmed orders by placement date: today, last 7 and 30 days
 * (Vietnam calendar days, today included). Owner/Manager only (`dashboard.viewRevenue`).
 */
export async function revenueStats(db: Reader, now: Date = new Date()): Promise<RevenueStats> {
  const today = startOfVietnamDay(now);
  const windows = {
    today,
    last7Days: new Date(today.getTime() - 6 * DAY_MS),
    last30Days: new Date(today.getTime() - 29 * DAY_MS),
  };
  const net = sql`${orders.total} - ${orders.amountRefunded}`;
  const window = (start: Date) => ({
    revenue: sql<string>`coalesce(sum(${net}) filter (where ${orders.placedAt} >= ${start}), 0)`,
    orders: sql<number>`count(*) filter (where ${orders.placedAt} >= ${start})::int`,
  });
  const [row] = await db
    .select({
      todayRevenue: window(windows.today).revenue,
      todayOrders: window(windows.today).orders,
      weekRevenue: window(windows.last7Days).revenue,
      weekOrders: window(windows.last7Days).orders,
      monthRevenue: window(windows.last30Days).revenue,
      monthOrders: window(windows.last30Days).orders,
    })
    .from(orders)
    .where(
      and(
        gte(orders.placedAt, windows.last30Days),
        sql`${orders.status} not in (${sql.join(
          NON_REVENUE.map((status) => sql`${status}`),
          sql`, `,
        )})`,
      ),
    );
  const make = (revenue: string | number | undefined, n: number | undefined): RevenueWindow => {
    const total = Number(revenue ?? 0);
    const count = n ?? 0;
    return {
      revenue: total,
      orders: count,
      averageOrderValue: count ? Math.round(total / count) : 0,
    };
  };
  return {
    today: make(row?.todayRevenue, row?.todayOrders),
    last7Days: make(row?.weekRevenue, row?.weekOrders),
    last30Days: make(row?.monthRevenue, row?.monthOrders),
  };
}
