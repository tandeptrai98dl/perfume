import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import type { AuditRow, DiffEntry } from '@/server/modules/audit';

import { useOrderFormat } from '../orders/format';

/*
 * Audit log rows (§11.2) with entity link-outs and a before/after diff viewer. Rows arrive
 * redacted from the audit module (no contact data, truncated IP). Server Component: the diff
 * opens with a native <details>, so it needs no client JavaScript and works by keyboard.
 */

function DiffValue({ value }: { value: unknown }) {
  const t = useTranslations('admin.audit');
  if (value === null || value === undefined || value === '') {
    return <span className="text-taupe-600">{t('emptyValue')}</span>;
  }
  if (typeof value === 'object') {
    return (
      <pre className="text-eyebrow max-w-xs overflow-auto break-all whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="break-words">{String(value)}</span>;
}

export function DiffViewer({ entries, action }: { entries: DiffEntry[]; action: string }) {
  const t = useTranslations('admin.audit');
  if (entries.length === 0) return <span className="text-taupe-600">{t('noDiff')}</span>;
  return (
    <details className="max-w-xl">
      <summary className="cursor-pointer underline-offset-4 hover:underline">
        {t('showDiff', { count: entries.length })}
      </summary>
      <table className="text-small mt-2 w-full text-left">
        <caption className="sr-only">{t('diffCaption', { action })}</caption>
        <thead>
          <tr className="bg-sand-100">
            <th scope="col" className="px-2 py-1 font-medium">
              {t('diffColumns.field')}
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('diffColumns.from')}
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('diffColumns.to')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.field} className="border-line-200 border-t align-top">
              <th scope="row" className="px-2 py-1 font-mono font-normal break-all">
                {entry.field}
              </th>
              {entry.kind === 'change' ? (
                <>
                  <td className="text-danger px-2 py-1">
                    <DiffValue value={entry.from} />
                  </td>
                  <td className="text-success px-2 py-1">
                    <DiffValue value={entry.to} />
                  </td>
                </>
              ) : (
                <td colSpan={2} className="px-2 py-1">
                  <DiffValue value={entry.value} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AuditTable({ rows, caption }: { rows: AuditRow[]; caption: string }) {
  const t = useTranslations('admin');
  const format = useOrderFormat();
  const entityLabel = (type: string) =>
    t.has(`audit.entityTypes.${type}` as 'audit.entityTypes.order')
      ? t(`audit.entityTypes.${type}` as 'audit.entityTypes.order')
      : type;
  return (
    <div className="border-line-200 overflow-x-auto border">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sand-100">
          <tr>
            {(['time', 'actor', 'action', 'entity', 'changes', 'ip'] as const).map((column) => (
              <th
                key={column}
                scope="col"
                className="text-small px-3 py-2 font-medium whitespace-nowrap"
              >
                {t(`audit.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = row.href;
            const label = entityLabel(row.entityType);
            return (
              <tr
                key={row.id}
                className="border-line-200 border-t align-top"
                data-audit-id={row.id}
              >
                <td className="text-small px-3 py-2 whitespace-nowrap tabular-nums">
                  {format.dateTime(row.createdAt)}
                </td>
                <td className="text-small px-3 py-2">
                  {row.actorId ? (
                    <span className="flex flex-col">
                      <span>{row.actorName ?? t('audit.deletedActor')}</span>
                      {row.actorRole && row.actorRole !== 'customer' && (
                        <span className="text-taupe-600">
                          {t(`roles.${row.actorRole as 'owner'}`)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-taupe-600">{t('audit.system')}</span>
                  )}
                </td>
                <td className="text-small px-3 py-2 font-mono break-all">{row.action}</td>
                <td className="text-small px-3 py-2">
                  <span className="flex flex-col">
                    <span>{label}</span>
                    {row.entityId &&
                      (href ? (
                        <Link
                          href={href as Route}
                          className="text-gold-700 font-mono break-all underline-offset-4 hover:underline"
                          aria-label={t('audit.open', { entity: `${label} ${row.entityId}` })}
                        >
                          {row.entityId}
                        </Link>
                      ) : (
                        <span className="font-mono break-all text-taupe-600">{row.entityId}</span>
                      ))}
                  </span>
                </td>
                <td className="text-small px-3 py-2">
                  <DiffViewer entries={row.changes} action={row.action} />
                </td>
                <td className="text-small px-3 py-2 font-mono whitespace-nowrap text-taupe-600">
                  {row.ip ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState title={t('audit.empty')} />}
    </div>
  );
}
