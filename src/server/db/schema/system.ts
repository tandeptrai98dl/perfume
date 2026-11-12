import {
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, localeEnum, primaryId } from './_shared';
import { users } from './auth';

/** Operational settings. Never stores secrets (ADR-0007). */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => users.id),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Append-only audit trail of staff actions. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    diff: jsonb(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.entityType, t.entityId), index().on(t.actorId, t.createdAt)],
);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'email',
  'telegram',
  'zalo',
]);
export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'sent',
  'failed',
  'skipped',
]);

/**
 * Delivery log of customer/staff notifications (§6.2). `recipient` is stored masked
 * (`maskEmail` / `maskPhone`, never plain PII); the ref points at the order, review, etc.
 */
export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: primaryId(),
    channel: notificationChannelEnum().notNull(),
    recipient: text().notNull(),
    template: text().notNull(),
    locale: localeEnum(),
    refType: text(),
    refId: text(),
    status: notificationStatusEnum().notNull().default('queued'),
    error: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.refType, t.refId), index().on(t.createdAt)],
);

/** Fixed-window rate-limit counters shared by all web instances (MVP; Redis later). */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text().primaryKey(),
    count: integer().notNull().default(0),
    windowStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.windowStart)],
);
