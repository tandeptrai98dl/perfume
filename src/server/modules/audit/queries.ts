import { and, asc, desc, eq, gt, gte, inArray, like, lt, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { auditLogs, users } from '@/server/db/schema';

import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PAGE_SIZE,
  type AuditFilter,
  type AuditPageQuery,
} from './schemas';
import { diffEntries, entityHref, maskIp, redactAuditValue, type DiffEntry } from './view';

/*
 * Read side of the append-only audit trail (§11.2, owner: admin area). Pagination is keyset on
 * the UUIDv7 primary key, which is time-ordered (ADR-0010): `id < cursor ORDER BY id DESC`
 * walks the primary-key index and stays fast at any depth, unlike OFFSET. Rows leave this
 * module already redacted (no PII, truncated IP).
 */

type Reader = Pick<Database, 'select' | 'execute'>;

export type AuditRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** Redacted copy of the stored diff. */
  diff: unknown;
  /** The redacted diff flattened for the viewer. */
  changes: DiffEntry[];
  /** Admin page of the entity, when it has one. */
  href: string | null;
  /** Truncated client IP (`a.b.c.*`). */
  ip: string | null;
};

export type AuditPage = {
  rows: AuditRow[];
  /** Cursor for the next older page, when there is one. */
  olderCursor: string | null;
  /** Cursor for the next newer page, when there is one. */
  newerCursor: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of a Vietnam calendar date (`YYYY-MM-DD`) as an instant. */
function vietnamMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function filterConditions(filter: AuditFilter): (SQL | undefined)[] {
  return [
    filter.actorId ? eq(auditLogs.actorId, filter.actorId) : undefined,
    filter.entityType ? eq(auditLogs.entityType, filter.entityType) : undefined,
    filter.entityId ? eq(auditLogs.entityId, filter.entityId) : undefined,
    filter.action ? like(auditLogs.action, `${escapeLike(filter.action)}%`) : undefined,
    filter.from ? gte(auditLogs.createdAt, vietnamMidnight(filter.from)) : undefined,
    filter.to
      ? lt(auditLogs.createdAt, new Date(vietnamMidnight(filter.to).getTime() + DAY_MS))
      : undefined,
  ];
}

function baseSelect(db: Reader) {
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorRole: users.role,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      diff: auditLogs.diff,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId));
}

type RawRow = Awaited<ReturnType<ReturnType<typeof baseSelect>['execute']>>[number];

function present(row: RawRow): AuditRow {
  const diff = redactAuditValue(row.diff);
  return {
    ...row,
    diff,
    changes: diffEntries(diff),
    href: entityHref(row.entityType, row.entityId),
    ip: maskIp(row.ip),
  };
}

/** One page of entries, newest first, in the direction given by `dir` from `cursor`. */
export async function listAuditLogs(
  db: Reader,
  query: AuditPageQuery,
  pageSize: number = AUDIT_PAGE_SIZE,
): Promise<AuditPage> {
  const conditions = filterConditions(query);
  const newer = query.dir === 'newer' && !!query.cursor;
  if (query.cursor) {
    conditions.push(newer ? gt(auditLogs.id, query.cursor) : lt(auditLogs.id, query.cursor));
  }
  const fetched = await baseSelect(db)
    .where(and(...conditions))
    .orderBy(newer ? asc(auditLogs.id) : desc(auditLogs.id))
    .limit(pageSize + 1);
  const more = fetched.length > pageSize;
  const page = fetched.slice(0, pageSize);
  if (newer) page.reverse();
  const rows = page.map(present);
  const first = rows[0]?.id ?? null;
  const last = rows.at(-1)?.id ?? null;
  return {
    rows,
    olderCursor: (newer ? true : more) ? last : null,
    newerCursor: (newer ? more : !!query.cursor) ? first : null,
  };
}

/** Rows for the CSV export (newest first), capped at AUDIT_EXPORT_LIMIT. */
export async function exportAuditLogs(
  db: Reader,
  filter: AuditFilter,
  limit: number = AUDIT_EXPORT_LIMIT,
): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const fetched = await baseSelect(db)
    .where(and(...filterConditions(filter)))
    .orderBy(desc(auditLogs.id))
    .limit(limit + 1);
  return { rows: fetched.slice(0, limit).map(present), truncated: fetched.length > limit };
}

/**
 * Distinct entity types for the filter. A loose index scan over the `(entity_type, entity_id)`
 * index (recursive CTE) reads one index entry per type instead of the whole table.
 */
export async function listAuditEntityTypes(db: Reader): Promise<string[]> {
  const result = await db.execute<{ entity_type: string }>(sql`
    with recursive types as (
      (select ${auditLogs.entityType} as entity_type from ${auditLogs}
        order by ${auditLogs.entityType} limit 1)
      union all
      select (select a.entity_type from ${auditLogs} a
              where a.entity_type > types.entity_type
              order by a.entity_type limit 1)
      from types where types.entity_type is not null
    )
    select entity_type from types where entity_type is not null`);
  return result.rows.map((row) => row.entity_type);
}

// ---------- M3 wave 2 (customers stream): entity history read by the owning screen ----------

export type EntityAuditEntry = {
  id: string;
  action: string;
  actorName: string | null;
  /** The stored diff, unredacted: only for screens whose permission covers its content. */
  diff: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * Newest audit rows of one entity with the given actions (e.g. customer notes and COD risk
 * changes on `/admin/customers/[id]`). Unlike the audit log viewer the diff is not redacted:
 * callers show it only behind the permission that already grants the underlying data.
 */
export async function listEntityAuditEntries(
  db: Pick<Database, 'select'>,
  input: { entityType: string; entityId: string; actions: readonly string[]; limit?: number },
): Promise<EntityAuditEntry[]> {
  if (input.actions.length === 0) return [];
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorName: users.name,
      diff: auditLogs.diff,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(
      and(
        eq(auditLogs.entityType, input.entityType),
        eq(auditLogs.entityId, input.entityId),
        inArray(auditLogs.action, [...input.actions]),
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(Math.min(input.limit ?? 50, 200));
  return rows.map((row) => ({
    ...row,
    diff:
      row.diff && typeof row.diff === 'object' && !Array.isArray(row.diff)
        ? (row.diff as Record<string, unknown>)
        : null,
  }));
}
