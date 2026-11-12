/**
 * Audit module public API (M3 audit log viewer, §11.2). Read side only: rows are written by
 * every module with `recordAudit` (src/server/lib/audit.ts) inside its own transaction.
 * Shared with the worker: no `server-only`, no Next.js APIs.
 */
export { exportAuditLogCsv } from './export';
export {
  exportAuditLogs,
  listAuditEntityTypes,
  listAuditLogs,
  listEntityAuditEntries,
  type AuditPage,
  type AuditRow,
  type EntityAuditEntry,
} from './queries';
export {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PAGE_SIZE,
  auditFilterSchema,
  auditPageSchema,
  type AuditFilter,
  type AuditPageQuery,
} from './schemas';
export {
  csvCell,
  diffEntries,
  entityHref,
  maskIp,
  REDACTED,
  redactAuditValue,
  toCsv,
  type DiffEntry,
} from './view';
