import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, createdAt, localeEnum, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { products } from './catalog';

/** Two-level administrative units (province → ward), seeded from vn-admin-units.json. */
export const provinces = pgTable('provinces', {
  code: text().primaryKey(),
  name: text().notNull(),
  nameAscii: text().notNull(),
  slug: text().notNull().unique(),
});

export const wards = pgTable(
  'wards',
  {
    code: text().primaryKey(),
    provinceCode: text()
      .notNull()
      .references(() => provinces.code),
    name: text().notNull(),
    nameAscii: text().notNull(),
    slug: text().notNull(),
  },
  (t) => [index().on(t.provinceCode)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullName: text().notNull(),
    phone: text().notNull(),
    provinceCode: text()
      .notNull()
      .references(() => provinces.code),
    wardCode: text()
      .notNull()
      .references(() => wards.code),
    /** Optional pre-2025 district name for carriers that still require it. */
    legacyDistrict: text(),
    street: text().notNull(),
    isDefault: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const wishlists = pgTable(
  'wishlists',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

export const consentPurposeEnum = pgEnum('consent_purpose', [
  'terms',
  'privacy',
  'marketing_email',
  'marketing_sms',
  'analytics',
  'ads',
]);

/** Append-only consent log (Personal Data Protection Law). Never UPDATE rows. */
export const consents = pgTable(
  'consents',
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    email: citext(),
    phone: text(),
    purpose: consentPurposeEnum().notNull(),
    granted: boolean().notNull(),
    policyVersion: text().notNull(),
    locale: localeEnum().notNull(),
    source: text().notNull(),
    ip: inet(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), index().on(t.email)],
);

export const newsletterStatusEnum = pgEnum('newsletter_status', ['subscribed', 'unsubscribed']);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: primaryId(),
  email: citext().notNull().unique(),
  locale: localeEnum().notNull(),
  status: newsletterStatusEnum().notNull().default('subscribed'),
  consentId: uuid().references(() => consents.id),
  source: text().notNull(),
  ...timestamps(),
});

export const privacyRequestTypeEnum = pgEnum('privacy_request_type', [
  'export',
  'delete',
  'correct',
  'withdraw_consent',
]);
export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'received',
  'in_progress',
  'completed',
  'rejected',
]);

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    email: citext().notNull(),
    type: privacyRequestTypeEnum().notNull(),
    status: privacyRequestStatusEnum().notNull().default('received'),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    handledBy: uuid().references(() => users.id),
    completedAt: timestamp({ withTimezone: true }),
    note: text(),
    ...timestamps(),
  },
  (t) => [
    index().on(t.status, t.dueAt),
    check(
      'privacy_requests_completed_check',
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
  ],
);
