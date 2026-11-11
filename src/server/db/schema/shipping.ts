import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { localeEnum, money, primaryId, timestamps } from './_shared';
import { orders } from './orders';

export const carrierEnum = pgEnum('carrier', ['self', 'ghn', 'ghtk', 'viettel_post', 'other']);
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'pending',
  'in_transit',
  'delivered',
  'failed',
  'returned',
]);

/** Province groups priced together (internal name). An empty list never matches. */
export const shippingZones = pgTable('shipping_zones', {
  id: primaryId(),
  name: text().notNull(),
  provinceCodes: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  position: integer().notNull().default(0),
  ...timestamps(),
});

/** Weight-band rate within a zone; `free_over_subtotal` makes it free above that subtotal. */
export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: primaryId(),
    zoneId: uuid()
      .notNull()
      .references(() => shippingZones.id, { onDelete: 'cascade' }),
    minWeightG: integer().notNull().default(0),
    maxWeightG: integer(),
    fee: money().notNull(),
    freeOverSubtotal: money(),
    etaMinDays: integer().notNull(),
    etaMaxDays: integer().notNull(),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index().on(t.zoneId, t.isActive),
    check(
      'shipping_rates_bounds_check',
      sql`${t.fee} >= 0 AND ${t.minWeightG} >= 0 AND (${t.maxWeightG} IS NULL OR ${t.maxWeightG} > ${t.minWeightG})
        AND ${t.etaMinDays} >= 0 AND ${t.etaMaxDays} >= ${t.etaMinDays}`,
    ),
  ],
);

export const shippingRateTranslations = pgTable(
  'shipping_rate_translations',
  {
    rateId: uuid()
      .notNull()
      .references(() => shippingRates.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.rateId, t.locale] })],
);

export const shipments = pgTable(
  'shipments',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrier: carrierEnum().notNull(),
    trackingCode: text().notNull(),
    status: shipmentStatusEnum().notNull().default('pending'),
    codAmount: money().notNull().default(0),
    feeActual: money(),
    labelUrl: text(),
    shippedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    raw: jsonb(),
    ...timestamps(),
  },
  (t) => [index().on(t.orderId), index().on(t.carrier, t.trackingCode)],
);
