import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, money, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { media } from './catalog';
import { orders } from './orders';

export const paymentProviderEnum = pgEnum('payment_provider', [
  'cod',
  'vnpay',
  'payos',
  'bank_manual',
  'momo',
  'zalopay',
]);
export const paymentKindEnum = pgEnum('payment_kind', ['full', 'deposit', 'balance', 'adjustment']);
export const paymentAttemptStatusEnum = pgEnum('payment_attempt_status', [
  'pending',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
  'refunded',
]);
export const refundMethodEnum = pgEnum('refund_method', ['gateway', 'bank_transfer', 'cash']);
export const refundStatusEnum = pgEnum('refund_status', [
  'requested',
  'processing',
  'completed',
  'failed',
]);

/**
 * One row per payment attempt (a 15-minute gateway session, ADR-0006). `txn_ref` is the
 * reference sent to the gateway and matched on IPN together with the amount (CLAUDE.md).
 */
export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: paymentProviderEnum().notNull(),
    kind: paymentKindEnum().notNull(),
    amount: money().notNull(),
    status: paymentAttemptStatusEnum().notNull().default('pending'),
    txnRef: text().notNull().unique(),
    providerTxnId: text(),
    bankCode: text(),
    /** Payment link / QR payload shown to the customer (no secrets). */
    checkoutUrl: text(),
    qrCode: text(),
    expiresAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    /** Staff member who confirmed a manual bank transfer. */
    confirmedBy: uuid().references(() => users.id),
    /** Sanitized provider payload (never secrets or card data). */
    raw: jsonb(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.orderId),
    index().on(t.status, t.expiresAt),
    check('payments_amount_check', sql`${t.amount} > 0`),
  ],
);

/**
 * Every inbound IPN/webhook, valid or not, for idempotency and audit. A replayed notification
 * hits the unique `idempotency_key` and is acknowledged without side effects.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: primaryId(),
    provider: paymentProviderEnum().notNull(),
    eventType: text().notNull(),
    idempotencyKey: text().notNull().unique(),
    paymentId: uuid().references(() => payments.id),
    payload: jsonb().notNull(),
    signatureValid: boolean().notNull(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.paymentId), index().on(t.createdAt)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    paymentId: uuid().references(() => payments.id),
    amount: money().notNull(),
    reason: text().notNull(),
    method: refundMethodEnum().notNull(),
    status: refundStatusEnum().notNull().default('requested'),
    providerRef: text(),
    proofMediaId: uuid().references(() => media.id),
    /** Staff member who requested/processed it; null when created by the system (late IPN). */
    actorId: uuid().references(() => users.id),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index().on(t.orderId),
    index().on(t.status),
    check('refunds_amount_check', sql`${t.amount} > 0`),
  ],
);

export const codRemittances = pgTable(
  'cod_remittances',
  {
    id: primaryId(),
    carrier: text().notNull(),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    totalAmount: money().notNull(),
    carrierFee: money().notNull().default(0),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    bankReference: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (t) => [index().on(t.receivedAt)],
);

export const codRemittanceOrders = pgTable(
  'cod_remittance_orders',
  {
    remittanceId: uuid()
      .notNull()
      .references(() => codRemittances.id, { onDelete: 'cascade' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    amount: money().notNull(),
  },
  (t) => [primaryKey({ columns: [t.remittanceId, t.orderId] }), index().on(t.orderId)],
);
