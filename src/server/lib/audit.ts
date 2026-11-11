import { auditLogs } from '@/server/db/schema';

import type { Database } from '@/server/db/client';

/**
 * Append-only audit trail of staff actions (ARCHITECTURE.md §11.2 "Staff & audit").
 * Call inside the business transaction so the entry exists if and only if the change commits.
 * Never put PII (phone, email, address) in `diff`.
 */
export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff?: unknown;
  ip?: string | null;
};

export async function writeAuditLog(tx: Pick<Database, 'insert'>, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
  });
}
