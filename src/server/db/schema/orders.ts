import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, createdAt, localeEnum, money, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { products, productVariants } from './catalog';

/** Fulfilment lifecycle (ARCHITECTURE.md §3.5, ADR-0005). Changed only via `transitionOrder()`. */
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'returned',
]);

/** Money lifecycle (ADR-0005). Changed only by the payment module. */
export const paymentStatusEnum = pgEnum('payment_status', [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'cod',
  'vnpay',
  'payos',
  'bank_transfer',
  'momo',
  'zalopay',
]);

export const orderSourceEnum = pgEnum('order_source', ['web', 'admin']);
export const orderAddressTypeEnum = pgEnum('order_address_type', ['shipping', 'billing']);
export const actorTypeEnum = pgEnum('actor_type', ['system', 'customer', 'staff']);

export const orders = pgTable(
  'orders',
  {
    id: primaryId(),
    /** Human-readable code, e.g. "PF-261111-7K3Q" (readable over the phone). */
    code: text().notNull().unique(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    email: citext().notNull(),
    phone: text().notNull(),
    customerName: text().notNull(),
    locale: localeEnum().notNull(),
    source: orderSourceEnum().notNull().default('web'),
    createdBy: uuid().references(() => users.id),
    status: orderStatusEnum().notNull(),
    paymentStatus: paymentStatusEnum().notNull().default('unpaid'),
    paymentMethod: paymentMethodEnum().notNull(),
    subtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    shippingFee: money().notNull().default(0),
    giftWrapFee: money().notNull().default(0),
    total: money().notNull(),
    depositRequired: money().notNull().default(0),
    amountPaid: money().notNull().default(0),
    amountRefunded: money().notNull().default(0),
    amountDue: money()
      .notNull()
      .generatedAlwaysAs(sql`total - amount_paid`),
    couponCode: text(),
    giftWrap: boolean().notNull().default(false),
    giftMessage: text(),
    hidePrices: boolean().notNull().default(false),
    customerNote: text(),
    internalNote: text(),
    /** Company VAT invoice details: { companyName, taxCode, address, email } (D13). */
    vatInvoice: jsonb(),
    einvoiceRef: text(),
    einvoiceIssuedAt: timestamp({ withTimezone: true }),
    /** Idempotency key of the checkout session that created the order (duplicate submits). */
    checkoutKey: text().unique(),
    shippingRateId: uuid(),
    ipAddress: inet(),
    userAgent: text(),
    placedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    /** Optimistic lock for staff edits. */
    version: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index().on(t.status, t.placedAt),
    index().on(t.paymentStatus),
    index().on(t.userId, t.placedAt),
    index().on(t.phone),
    index().on(t.email),
    index().on(t.placedAt),
    check(
      'orders_amounts_check',
      sql`${t.subtotal} >= 0 AND ${t.discountTotal} >= 0 AND ${t.shippingFee} >= 0
        AND ${t.giftWrapFee} >= 0 AND ${t.total} >= 0 AND ${t.amountPaid} >= 0
        AND ${t.amountRefunded} >= 0 AND ${t.depositRequired} >= 0`,
    ),
    check('orders_gift_message_length', sql`char_length(${t.giftMessage}) <= 200`),
  ],
);

/** Snapshot of what was bought: names/prices are copied so later catalogue edits never change it. */
export const orderItems = pgTable(
  'order_items',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    productName: text().notNull(),
    variantLabel: text().notNull(),
    sku: text().notNull(),
    imageUrl: text(),
    unitPrice: money().notNull(),
    compareAtPrice: money(),
    quantity: integer().notNull(),
    discountAllocated: money().notNull().default(0),
    lineTotal: money().notNull(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.orderId),
    index().on(t.variantId),
    check('order_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export const orderAddresses = pgTable(
  'order_addresses',
  {
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: orderAddressTypeEnum().notNull(),
    fullName: text().notNull(),
    phone: text().notNull(),
    provinceCode: text().notNull(),
    provinceName: text().notNull(),
    wardCode: text().notNull(),
    wardName: text().notNull(),
    /** Pre-2025 district name when the customer still uses it (optional, display only). */
    legacyDistrict: text(),
    street: text().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.type] })],
);

/** Append-only order timeline: every status/payment change, edit and note (§3.5). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    fromStatus: text(),
    toStatus: text(),
    message: text(),
    diff: jsonb(),
    actorType: actorTypeEnum().notNull(),
    actorId: uuid().references(() => users.id),
    metadata: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId, t.createdAt)],
);
