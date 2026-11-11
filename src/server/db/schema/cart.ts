import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { localeEnum, money, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { productVariants } from './catalog';

export const cartStatusEnum = pgEnum('cart_status', ['active', 'converted', 'abandoned']);

/**
 * Guest carts are identified by a random token kept in an httpOnly `cart_token` cookie (30 days);
 * only its SHA-256 hash is stored. Member carts have `user_id`; on sign-in the guest cart is
 * merged into the member cart (§10.3).
 */
export const carts = pgTable(
  'carts',
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().unique(),
    locale: localeEnum().notNull().default('vi'),
    status: cartStatusEnum().notNull().default('active'),
    couponCode: text(),
    giftWrap: boolean().notNull().default(false),
    giftMessage: text(),
    hidePrices: boolean().notNull().default(false),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.userId, t.status),
    index().on(t.status, t.expiresAt),
    check('carts_owner_check', sql`${t.userId} IS NOT NULL OR ${t.tokenHash} IS NOT NULL`),
    check('carts_gift_message_length', sql`char_length(${t.giftMessage}) <= 200`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: primaryId(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer().notNull(),
    /** Unit price when added, to flag price changes since (§10.3); never used for charging. */
    priceWhenAdded: money().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.cartId, t.variantId),
    check('cart_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);
