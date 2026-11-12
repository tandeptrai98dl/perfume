import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { FailedEinvoiceRow } from '@/server/modules/einvoice';
import type { OrderStatus } from '@/server/modules/order';

import { EinvoiceReason, EinvoiceRetryButton } from './einvoice-status';
import { useOrderFormat } from './format';

/** Orders whose e-invoice failed for good, newest failure first, with a retry per row. */
export function FailedEinvoiceTable({
  rows,
  canProcess,
}: {
  rows: FailedEinvoiceRow[];
  canProcess: boolean;
}) {
  const t = useTranslations('admin');
  const format = useOrderFormat();
  const columns = [
    'order',
    'status',
    'total',
    'deliveredAt',
    'reason',
    'attempts',
    'failedAt',
  ] as const;
  return (
    <div className="border-line-200 overflow-x-auto border bg-white">
      <table className="text-small w-full border-collapse text-left" data-testid="failed-einvoices">
        <caption className="sr-only">{t('einvoices.caption')}</caption>
        <thead className="bg-sand-100">
          <tr>
            {columns.map((key) => (
              <th key={key} scope="col" className="px-3 py-2 font-medium">
                {t(`einvoices.columns.${key}`)}
              </th>
            ))}
            {canProcess && (
              <th scope="col" className="px-3 py-2 font-medium">
                {t('einvoices.columns.actions')}
              </th>
            )}
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
              <td className="px-3 py-2">{t(`orders.status.${row.status as OrderStatus}`)}</td>
              <td className="px-3 py-2 tabular-nums">{format.vnd(row.total)}</td>
              <td className="px-3 py-2 tabular-nums">
                {row.deliveredAt ? format.dateTime(row.deliveredAt) : '—'}
              </td>
              <td className="px-3 py-2">
                <EinvoiceReason reason={row.reason} />
              </td>
              <td className="px-3 py-2 tabular-nums">{row.attempts ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">{format.dateTime(row.failedAt)}</td>
              {canProcess && (
                <td className="px-3 py-2">
                  <EinvoiceRetryButton
                    orderId={row.orderId}
                    label={t('einvoices.retryNamed', { code: row.code })}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
