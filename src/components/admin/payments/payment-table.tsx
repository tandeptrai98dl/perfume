'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import type { PaymentListRow } from '@/server/modules/payment';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { ATTEMPT_TONES, DATE_TIME, orderHref, VND } from './format';

const PROVIDERS = ['vnpay', 'payos', 'bank_manual', 'cod'] as const;
const STATUSES = ['pending', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'] as const;

/** Transactions by gateway (§11.2 Payments). */
export function PaymentTable(props: {
  rows: PaymentListRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.payments');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<PaymentListRow>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('columns.createdAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.dateTime(row.original.createdAt, DATE_TIME)}</span>
        ),
      },
      {
        id: 'order',
        header: t('columns.order'),
        cell: ({ row }) => (
          <Link
            href={orderHref(row.original.orderId) as Route}
            prefetch={false}
            className="font-mono underline-offset-4 hover:underline"
          >
            {row.original.orderCode}
          </Link>
        ),
      },
      {
        id: 'provider',
        header: t('columns.provider'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{t(`providers.${row.original.provider as 'vnpay'}`)}</span>
            <span className="text-taupe-600">{t(`kinds.${row.original.kind as 'full'}`)}</span>
          </span>
        ),
      },
      {
        id: 'amount',
        header: t('columns.amount'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {format.number(row.original.amount, VND)}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <Badge variant={ATTEMPT_TONES[row.original.status] ?? 'neutral'}>
            {t(`attemptStatus.${row.original.status as 'pending'}`)}
          </Badge>
        ),
      },
      {
        id: 'txnRef',
        header: t('columns.txnRef'),
        cell: ({ row }) => (
          <span className="flex flex-col font-mono">
            <span>{row.original.txnRef}</span>
            {row.original.providerTxnId && (
              <span className="text-taupe-600">{row.original.providerTxnId}</span>
            )}
          </span>
        ),
      },
      {
        id: 'confirmedBy',
        header: t('columns.confirmedBy'),
        cell: ({ row }) => row.original.confirmedByName ?? '—',
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
      caption={t('title')}
      searchLabel={t('search')}
      filters={
        <>
          <FilterSelect
            param="provider"
            label={t('filter.provider')}
            allLabel={t('filter.all')}
            options={PROVIDERS.map((value) => ({ value, label: t(`providers.${value}`) }))}
          />
          <FilterSelect
            param="status"
            label={t('filter.status')}
            allLabel={t('filter.all')}
            options={STATUSES.map((value) => ({ value, label: t(`attemptStatus.${value}`) }))}
          />
        </>
      }
      emptyTitle={t('empty')}
    />
  );
}
