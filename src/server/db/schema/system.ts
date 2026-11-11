import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt, primaryId } from './_shared';
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
