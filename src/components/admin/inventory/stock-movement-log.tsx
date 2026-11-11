'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { MovementRow } from '@/server/modules/inventory';
import { cn } from '@/lib/utils';

import { DataTable, type DataTableColumn } from '../data-table/data-table';

const REASONS = [
  'purchase',
  'sale',
  'reserve',
  'release',
  'adjustment',
  'return',
  'damage',
] as const;

/** StockMovementLog (§8.4): append-only, read-only history of every stock change. */
export function StockMovementLog({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.inventory');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<MovementRow>[]>(
    () => [
      {
        id: 'time',
        header: t('movements.columns.time'),
        cell: ({ row }) => (
          <time
            dateTime={new Date(row.original.createdAt).toISOString()}
            className="whitespace-nowrap"
          >
            {format.dateTime(row.original.createdAt, { dateStyle: 'short', timeStyle: 'medium' })}
          </time>
        ),
      },
      {
        id: 'product',
        header: t('movements.columns.product'),
        cell: ({ row }) => row.original.productName,
      },
      {
        id: 'sku',
        header: t('movements.columns.sku'),
        cell: ({ row }) => <span className="font-mono">{row.original.sku}</span>,
      },
      {
        id: 'delta',
        header: t('movements.columns.delta'),
        cell: ({ row }) => (
          <span
            className={cn(
              'font-medium tabular-nums',
              row.original.delta < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {row.original.delta > 0 ? `+${row.original.delta}` : row.original.delta}
          </span>
        ),
      },
      {
        id: 'reason',
        header: t('movements.columns.reason'),
        cell: ({ row }) => {
          const reason = row.original.reason as (typeof REASONS)[number];
          return REASONS.includes(reason) ? t(`reasons.${reason}`) : row.original.reason;
        },
      },
      {
        id: 'note',
        header: t('movements.columns.note'),
        cell: ({ row }) => row.original.note ?? '',
      },
      {
        id: 'actor',
        header: t('movements.columns.actor'),
        cell: ({ row }) => row.original.actorName ?? t('movements.system'),
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('movements.title')}
      searchLabel={t('movements.search')}
      emptyTitle={t('movements.empty')}
    />
  );
}
