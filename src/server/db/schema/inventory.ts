import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { productVariants } from './catalog';
import { orders } from './orders';

/** MVP has a single default location (ADR-0022); the model is multi-location ready. */
export const locations = pgTable('locations', {
  id: primaryId(),
  name: text().notNull(),
  address: text(),
  isDefault: boolean().notNull().default(false),
  ...timestamps(),
});

export const inventoryItems = pgTable(
  'inventory_items',
  {
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    lowStockThreshold: integer().notNull().default(3),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    check(
      'inventory_items_quantities_check',
      sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`,
    ),
  ],
);

export const stockMovementReasonEnum = pgEnum('stock_movement_reason', [
  'purchase',
  'sale',
  'reserve',
  'release',
  'adjustment',
  'return',
  'damage',
]);

/** Append-only log of every stock change. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: primaryId(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    delta: integer().notNull(),
    reason: stockMovementReasonEnum().notNull(),
    refType: text(),
    refId: uuid(),
    note: text(),
    actorId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.variantId, t.createdAt),
    index().on(t.createdAt),
    check('stock_movements_delta_check', sql`${t.delta} <> 0`),
  ],
);

export const reservationStatusEnum = pgEnum('reservation_status', [
  'active',
  'committed',
  'released',
]);

/**
 * Time-limited holds on stock for unpaid / unconfirmed orders (ADR-0006). `inventory_items.reserved`
 * is the sum of active reservations; a reservation is either committed (turned into a real
 * deduction when the order is paid/confirmed) or released (expiry, cancellation).
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    quantity: integer().notNull(),
    status: reservationStatusEnum().notNull().default('active'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.status, t.expiresAt),
    index().on(t.orderId),
    check('stock_reservations_quantity_check', sql`${t.quantity} > 0`),
  ],
);
