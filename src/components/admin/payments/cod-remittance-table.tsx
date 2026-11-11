'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { CodRemittanceRow } from '@/server/modules/payment';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { VND } from './format';

/** Saved COD remittances: carrier statement vs. money received. */
export function CodRemittanceTable(props: {
  rows: CodRemittanceRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.payments.cod');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<CodRemittanceRow>[]>(
    () => [
      {
        id: 'receivedAt',
        header: t('columns.receivedAt'),
        cell: ({ row }) => format.dateTime(row.original.receivedAt, { dateStyle: 'short' }),
      },
      {
        id: 'carrier',
        header: t('columns.carrier'),
        cell: ({ row }) => t(`carriers.${row.original.carrier as 'ghn'}`),
      },
      {
        id: 'period',
        header: t('columns.period'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.periodStart} – {row.original.periodEnd}
          </span>
        ),
      },
      {
        id: 'orders',
        header: t('columns.orders'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.orderCount}</span>,
      },
      {
        id: 'ordersAmount',
        header: t('columns.ordersAmount'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.number(row.original.ordersAmount, VND)}</span>
        ),
      },
      {
        id: 'fee',
        header: t('columns.fee'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.number(row.original.carrierFee, VND)}</span>
        ),
      },
      {
        id: 'total',
        header: t('columns.total'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {format.number(row.original.totalAmount, VND)}
          </span>
        ),
      },
      {
        id: 'reference',
        header: t('columns.reference'),
        cell: ({ row }) => <span className="font-mono">{row.original.bankReference ?? '—'}</span>,
      },
      {
        id: 'createdBy',
        header: t('columns.createdBy'),
        cell: ({ row }) => row.original.createdByName ?? '—',
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={props.rows}
      total={props.total}
      page={props.page}
      pageSize={props.pageSize}
      getRowId={(row) => row.id}
      caption={t('listTitle')}
      emptyTitle={t('empty')}
    />
  );
}
