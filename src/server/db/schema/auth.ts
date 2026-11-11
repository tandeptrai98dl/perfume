import { boolean, date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { citext, localeEnum, primaryId, timestamps } from './_shared';

/**
 * Tables used by Better Auth (users, sessions, accounts, verifications, two_factors).
 * Property names follow Better Auth's field names; columns are snake_case via the
 * `casing: 'snake_case'` option of the Drizzle client and drizzle-kit config.
 */

export const userRoleEnum = pgEnum('user_role', [
  'customer',
  'owner',
  'manager',
  'staff',
  'editor',
]);
export const genderEnum = pgEnum('gender', ['female', 'male', 'other']);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    name: text().notNull(),
    email: citext().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    phone: text(),
    birthday: date(),
    gender: genderEnum(),
    role: userRoleEnum().notNull().default('customer'),
    locale: localeEnum().notNull().default('vi'),
    twoFactorEnabled: boolean().notNull().default(false),
    banned: boolean().notNull().default(false),
    banReason: text(),
    banExpires: timestamp({ withTimezone: true }),
    marketingOptIn: boolean().notNull().default(false),
    /** Set after a failed COD delivery (ADR-0016). */
    codRiskFlag: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.phone), index().on(t.role)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** True only when the session completed a TOTP challenge; required for /admin. */
    twoFactorVerified: boolean().notNull().default(false),
    impersonatedBy: uuid(),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    /** Password hash (scrypt) for the email/password provider. */
    password: text(),
    ...timestamps(),
  },
  (t) => [index().on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: primaryId(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.identifier)],
);

export const twoFactors = pgTable(
  'two_factors',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Encrypted by Better Auth before storage. */
    secret: text().notNull(),
    backupCodes: text().notNull(),
  },
  (t) => [index().on(t.userId)],
);
