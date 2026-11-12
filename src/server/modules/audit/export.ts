import { recordAudit } from '@/server/lib/audit';
import { assertCan, type CommandContext } from '@/server/lib/command-context';

import { exportAuditLogs } from './queries';
import type { AuditFilter } from './schemas';
import { toCsv } from './view';

const HEADER = [
  'created_at',
  'actor',
  'actor_role',
  'action',
  'entity_type',
  'entity_id',
  'diff',
  'ip',
];

/**
 * CSV export of the filtered audit log (bulk data leaves the system, so: `auditLog.view` +
 * `customers.export`, i.e. Owner only per §11.1 "Export … (CSV)"). Rows are redacted like the
 * viewer, and the export itself is audited with its filters and row count.
 */
export async function exportAuditLogCsv(
  ctx: Pick<CommandContext, 'db' | 'actor' | 'ip'>,
  filter: AuditFilter,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  assertCan(ctx.actor, 'auditLog.view');
  assertCan(ctx.actor, 'customers.export');
  const { rows, truncated } = await exportAuditLogs(ctx.db, filter);
  const csv = toCsv(
    HEADER,
    rows.map((row) => [
      row.createdAt,
      row.actorName ?? '',
      row.actorRole ?? '',
      row.action,
      row.entityType,
      row.entityId ?? '',
      row.diff ?? '',
      row.ip ?? '',
    ]),
  );
  await recordAudit(ctx.db, {
    actorId: ctx.actor.id,
    action: 'audit_log.export',
    entityType: 'audit_log',
    entityId: null,
    diff: {
      filter: Object.fromEntries(Object.entries(filter).filter(([, value]) => value != null)),
      rows: rows.length,
      truncated,
    },
    ip: ctx.ip,
  });
  return { csv, rows: rows.length, truncated };
}
