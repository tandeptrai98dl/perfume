import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, money, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { orders } from './orders';

export const couponTypeEnum = pgEnum('coupon_type', ['percent', 'fixed', 'free_shipping']);

/**
 * `value` is a whole percent for `percent`, VND for `fixed`, unused for `free_shipping`.
 * `scope` = { brandIds?: string[], categoryIds?: string[], productIds?: string[] } (empty = all).
 */
export const coupons = pgTable(
  'coupons',
  {
    id: primaryId(),
    code: citext().notNull().unique(),
    type: couponTypeEnum().notNull(),
    value: money().notNull().default(0),
    maxDiscount: money(),
    minSubtotal: money(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    usageLimit: integer(),
    perCustomerLimit: integer(),
    usedCount: integer().notNull().default(0),
    scope: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    excludeSaleItems: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    /** Shown to staff only. */
    note: text(),
    ...timestamps(),
  },
  (t) => [
    check(
      'coupons_value_check',
      sql`${t.value} >= 0 AND (${t.type} <> 'percent' OR ${t.value} BETWEEN 1 AND 100)`,
    ),
  ],
);

/** One redemption per order; per-customer limits count by phone/email/user (§12 abuse). */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: primaryId(),
    couponId: uuid()
      .notNull()
      .references(() => coupons.id),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id),
    phone: text().notNull(),
    email: citext().notNull(),
    amount: money().notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.couponId, t.phone), index().on(t.couponId, t.email)],
);
