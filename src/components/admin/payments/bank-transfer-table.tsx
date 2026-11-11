'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import type { BankTransferOrderRow } from '@/server/modules/payment';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { ConfirmTransferDialog } from './confirm-transfer-dialog';
import { DATE_TIME, orderHref, VND } from './format';

/** Orders waiting for a manually confirmed bank transfer. */
export function BankTransferTable({ rows }: { rows: BankTransferOrderRow[] }) {
  const t = useTranslations('admin.payments');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<BankTransferOrderRow>[]>(
    () => [
      {
        id: 'order',
        header: t('bankTransfers.columns.order'),
        cell: ({ row }) => (
          <Link
            href={orderHref(row.original.orderId) as Route}
            className="font-mono underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'placedAt',
        header: t('bankTransfers.columns.placedAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.dateTime(row.original.placedAt, DATE_TIME)}</span>
        ),
      },
      {
        id: 'status',
        header: t('bankTransfers.columns.status'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{t(`orderStatus.${row.original.status as 'pending'}`)}</span>
            <span className="text-taupe-600">
              {t(`paymentStatus.${row.original.paymentStatus as 'unpaid'}`)}
            </span>
          </span>
        ),
      },
      {
        id: 'total',
        header: t('bankTransfers.columns.total'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.number(row.original.total, VND)}</span>
        ),
      },
      {
        id: 'paid',
        header: t('bankTransfers.columns.paid'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.number(row.original.amountPaid, VND)}</span>
        ),
      },
      {
        id: 'due',
        header: t('bankTransfers.columns.due'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {format.number(row.original.amountDue, VND)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('bankTransfers.confirm.open')}</span>,
        cell: ({ row }) => (
          <ConfirmTransferDialog
            order={row.original}
            trigger={
              <Button
                size="sm"
                aria-label={t('bankTransfers.confirm.openFor', { code: row.original.code })}
              >
                {t('bankTransfers.confirm.open')}
              </Button>
            }
          />
        ),
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={rows.length}
      page={1}
      pageSize={50}
      getRowId={(row) => row.orderId}
      caption={t('bankTransfers.title')}
      searchLabel={t('bankTransfers.search')}
      emptyTitle={t('bankTransfers.empty')}
    />
  );
}
