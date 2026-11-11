'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import type { PaymentEventRow } from '@/server/modules/payment';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { DATE_TIME } from './format';

const ERRORS = ['invalid_signature', 'unknown_txn_ref', 'amount_mismatch', 'already_succeeded'];

/** Webhook log: every IPN/webhook with signature result and processing outcome. */
export function PaymentEventTable(props: {
  rows: PaymentEventRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.payments');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<PaymentEventRow>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('events.columns.createdAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.dateTime(row.original.createdAt, DATE_TIME)}</span>
        ),
      },
      {
        id: 'provider',
        header: t('events.columns.provider'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{t(`providers.${row.original.provider as 'vnpay'}`)}</span>
            <span className="font-mono text-taupe-600">{row.original.eventType}</span>
          </span>
        ),
      },
      {
        id: 'signature',
        header: t('events.columns.signature'),
        cell: ({ row }) =>
          row.original.signatureValid ? (
            <Badge variant="success">{t('events.valid')}</Badge>
          ) : (
            <Badge variant="warning">{t('events.invalid')}</Badge>
          ),
      },
      {
        id: 'result',
        header: t('events.columns.result'),
        cell: ({ row }) =>
          row.original.error ? (
            <Badge variant="warning">
              {ERRORS.includes(row.original.error)
                ? t(`events.errors.${row.original.error as 'amount_mismatch'}`)
                : row.original.error}
            </Badge>
          ) : row.original.processedAt ? (
            <Badge variant="outline">{t('events.processed')}</Badge>
          ) : (
            '—'
          ),
      },
      {
        id: 'order',
        header: t('events.columns.order'),
        cell: ({ row }) => (
          <span className="flex flex-col font-mono">
            <span>{row.original.orderCode ?? '—'}</span>
            {row.original.txnRef && <span className="text-taupe-600">{row.original.txnRef}</span>}
          </span>
        ),
      },
      {
        id: 'payload',
        header: t('events.columns.payload'),
        cell: ({ row }) => (
          <details className="max-w-md">
            <summary className="cursor-pointer underline-offset-4 hover:underline">
              {t('events.showPayload')}
            </summary>
            <pre className="text-eyebrow bg-sand-100 mt-2 max-h-64 overflow-auto p-2 break-all whitespace-pre-wrap">
              {JSON.stringify(row.original.payload, null, 2)}
            </pre>
          </details>
        ),
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
      caption={t('events.title')}
      filters={
        <FilterSelect
          param="filter"
          label={t('events.filter.label')}
          allLabel={t('events.filter.all')}
          options={[
            { value: 'invalid', label: t('events.filter.invalid') },
            { value: 'unmatched', label: t('events.filter.unmatched') },
          ]}
        />
      }
      emptyTitle={t('events.empty')}
    />
  );
}
