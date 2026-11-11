import type { Database } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';

/**
 * Append-only staff audit trail (ARCHITECTURE.md §11.2 "Staff & audit"). Rows are written in
 * the same transaction as the change they describe. Diffs never contain PII: fields whose name
 * looks like contact data are replaced by a marker.
 */

type Executor = Pick<Database, 'insert'>;

export type FieldChange = { from: unknown; to: unknown };
export type AuditDiff = Record<string, FieldChange>;

const IGNORED_FIELDS = new Set(['createdAt', 'updatedAt', 'searchVector']);
const PII_FIELD = /^(email|phone|address|street|fullName|customerName|ip|ipAddress)$/i;
export const REDACTED = '[redacted]';

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Field-level before/after diff of two flat records (nested values are compared as JSON).
 * `before = null` describes a creation, `after = null` a deletion.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiff {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: AuditDiff = {};
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const from = before ? normalize(before[key]) : null;
    const to = after ? normalize(after[key]) : null;
    if (sameValue(from, to)) continue;
    diff[key] = PII_FIELD.test(key) ? { from: REDACTED, to: REDACTED } : { from, to };
  }
  return diff;
}

/** Prefixes every key of `diff` (e.g. `translations.vi.`) to merge diffs of related rows. */
export function prefixDiff(prefix: string, diff: AuditDiff): AuditDiff {
  return Object.fromEntries(Object.entries(diff).map(([key, value]) => [`${prefix}${key}`, value]));
}

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff?: AuditDiff | Record<string, unknown> | null;
  ip?: string | null;
};

export async function recordAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
  });
}
