import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import type { ReturnQueueRow } from '@/server/modules/returns';

import { useOrderFormat } from './format';

/** Return requests waiting for a decision or for the parcel, oldest request first. */
export function ReturnQueueTable({ rows }: { rows: ReturnQueueRow[] }) {
  const t = useTranslations('admin.returns');
  const format = useOrderFormat();
  const columns = [
    'order',
    'status',
    'requestedAt',
    'deliveredAt',
    'reason',
    'resolution',
    'units',
    'estimatedRefund',
  ] as const;
  return (
    <div className="border-line-200 overflow-x-auto border bg-white">
      <table className="text-small w-full border-collapse text-left" data-testid="return-queue">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="bg-sand-100">
          <tr>
            {columns.map((key) => (
              <th key={key} scope="col" className="px-3 py-2 font-medium">
                {t(`columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId} className="border-line-200 border-t align-top">
              <td className="px-3 py-2">
                <Link
                  href={`/admin/orders/${row.orderId}` as Route}
                  className="font-mono underline"
                >
                  {row.code}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Badge variant={row.status === 'requested' ? 'warning' : 'gold'}>
                  {t(`status.${row.status}`)}
                </Badge>
              </td>
              <td className="px-3 py-2 tabular-nums">{format.dateTime(row.requestedAt)}</td>
              <td className="px-3 py-2 tabular-nums">
                {row.deliveredAt ? format.dateTime(row.deliveredAt) : '—'}
              </td>
              <td className="px-3 py-2">{t(`reasons.${row.reason}`)}</td>
              <td className="px-3 py-2">{t(`resolutions.${row.resolution}`)}</td>
              <td className="px-3 py-2 tabular-nums">{row.units}</td>
              <td className="px-3 py-2 tabular-nums">{format.vnd(row.estimatedRefund)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
