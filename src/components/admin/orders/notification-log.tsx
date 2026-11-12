import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { NotificationLogRow } from '@/server/modules/notification';

import { useOrderFormat } from './format';

/*
 * Notification log of an order (§6.2 `notification_logs`): every customer e-mail and staff alert
 * with its channel, masked recipient and delivery status, newest first.
 */

const TONES = {
  queued: 'neutral',
  sent: 'success',
  failed: 'warning',
  skipped: 'outline',
} as const;

export function NotificationLog({ rows }: { rows: NotificationLogRow[] }) {
  const t = useTranslations('admin.orders.detail.notifications');
  const format = useOrderFormat();

  function template(value: string): string {
    const [base, kind] = value.split(':');
    const key = `templates.${base}` as 'templates.shipped';
    const label = t.has(key) ? t(key) : value;
    return base === 'staff_alert' && kind ? `${label} · ${kind}` : label;
  }

  function detail(row: NotificationLogRow): string | null {
    if (!row.error) return null;
    const key = `reasons.${row.error}` as 'reasons.no_recipient';
    return t.has(key) ? t(key) : row.error;
  }

  if (rows.length === 0) return <p className="text-small text-taupe-600">{t('empty')}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full border-collapse text-left" data-testid="notification-log">
        <caption className="sr-only">{t('title')}</caption>
        <thead className="bg-sand-100">
          <tr>
            {(['time', 'channel', 'template', 'recipient', 'status'] as const).map((key) => (
              <th key={key} scope="col" className="px-3 py-2 font-medium">
                {t(`columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-line-200 border-t align-top">
              <td className="px-3 py-2 tabular-nums">
                {format.dateTime(row.sentAt ?? row.createdAt)}
              </td>
              <td className="px-3 py-2">{t(`channels.${row.channel}`)}</td>
              <td className="px-3 py-2">
                {template(row.template)}
                {row.locale && <span className="text-taupe-600"> · {row.locale}</span>}
              </td>
              <td className="px-3 py-2 font-mono break-all">{row.recipient}</td>
              <td className="px-3 py-2">
                <span className="flex flex-col items-start gap-1">
                  <Badge variant={TONES[row.status]}>{t(`statuses.${row.status}`)}</Badge>
                  {detail(row) && <span className="break-words text-taupe-600">{detail(row)}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
