import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, createdAt, localeEnum, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { products } from './catalog';
import { orderItems } from './orders';

export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected']);

/**
 * Verified-purchase reviews (ADR-0008): one per purchased order item, moderated before
 * publication. Guests review through a one-time token link (`review_invitations`).
 */
export const reviews = pgTable(
  'reviews',
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    orderItemId: uuid()
      .notNull()
      .unique()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewerName: text().notNull(),
    locale: localeEnum().notNull(),
    rating: smallint().notNull(),
    longevity: smallint(),
    sillage: smallint(),
    title: text(),
    body: text().notNull(),
    status: reviewStatusEnum().notNull().default('pending'),
    adminReply: text(),
    moderatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('reviews_rating_check', sql`${t.rating} between 1 and 5`),
    check('reviews_longevity_check', sql`${t.longevity} is null or ${t.longevity} between 1 and 5`),
    check('reviews_sillage_check', sql`${t.sillage} is null or ${t.sillage} between 1 and 5`),
    index('reviews_product_published_idx')
      .on(t.productId, t.createdAt)
      .where(sql`${t.status} = 'approved'`),
    index().on(t.status, t.createdAt),
    index().on(t.userId),
  ],
);

/** One-time guest review link per delivered order item (token stored hashed, 30 days). */
export const reviewInvitations = pgTable(
  'review_invitations',
  {
    id: primaryId(),
    orderItemId: uuid()
      .notNull()
      .unique()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.expiresAt)],
);
