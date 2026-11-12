'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RefundRow } from '@/server/modules/payment';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { CompleteRefundDialog } from './complete-refund-dialog';
import { DATE_TIME, orderHref, REFUND_TONES, VND } from './format';

const KNOWN_REASONS = [
  'late_payment_after_cancellation',
  'overpayment',
  'order_cancelled',
  'return_shipping_payout',
];
/** Customer returns queue `return:<reason>` (ADR-0017). */
const RETURN_REASONS = ['unopened', 'defective', 'wrong_item', 'damaged'];

/** Refund queue (§11.2), including money received after cancellation. */
export function RefundTable(props: {
  rows: RefundRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Providers whose adapter can call a refund API (VNPay). */
  refundProviders: string[];
}) {
  const t = useTranslations('admin.payments');
  const tReturns = useTranslations('admin.returns');
  const format = useFormatter();
  const { refundProviders } = props;
  const columns = useMemo<DataTableColumn<RefundRow>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('refunds.columns.createdAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.dateTime(row.original.createdAt, DATE_TIME)}</span>
        ),
      },
      {
        id: 'order',
        header: t('refunds.columns.order'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <Link
              href={orderHref(row.original.orderId) as Route}
              prefetch={false}
              className="font-mono underline-offset-4 hover:underline"
            >
              {row.original.orderCode}
            </Link>
            <span className="text-taupe-600">
              {t(`orderStatus.${row.original.orderStatus as 'pending'}`)}
            </span>
          </span>
        ),
      },
      {
        id: 'amount',
        header: t('refunds.columns.amount'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {format.number(row.original.amount, VND)}
          </span>
        ),
      },
      {
        id: 'reason',
        header: t('refunds.columns.reason'),
        cell: ({ row }) => {
          const { reason } = row.original;
          if (KNOWN_REASONS.includes(reason)) {
            return t(`refunds.reasons.${reason as 'overpayment'}`);
          }
          const returnReason = reason.startsWith('return:') ? reason.slice(7) : null;
          if (returnReason && RETURN_REASONS.includes(returnReason)) {
            return t('refunds.reasons.return', {
              reason: tReturns(`reasons.${returnReason as 'unopened'}`),
            });
          }
          return reason;
        },
      },
      {
        id: 'method',
        header: t('refunds.columns.method'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{t(`refunds.methods.${row.original.method as 'gateway'}`)}</span>
            {row.original.paymentProvider && (
              <span className="text-taupe-600">
                {t(`providers.${row.original.paymentProvider as 'vnpay'}`)}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('refunds.columns.status'),
        cell: ({ row }) => (
          <Badge variant={REFUND_TONES[row.original.status] ?? 'neutral'}>
            {t(`refunds.status.${row.original.status as 'requested'}`)}
          </Badge>
        ),
      },
      {
        id: 'reference',
        header: t('refunds.columns.reference'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            {row.original.providerRef && (
              <span className="font-mono">{row.original.providerRef}</span>
            )}
            {row.original.proofUrl && (
              <a
                href={row.original.proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline"
              >
                {t('refunds.proof')}
              </a>
            )}
            {!row.original.providerRef && !row.original.proofUrl && '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('refunds.complete.open')}</span>,
        cell: ({ row }) =>
          row.original.status === 'completed' || row.original.status === 'processing' ? null : (
            <CompleteRefundDialog
              refund={row.original}
              gatewayProvider={
                row.original.method === 'gateway' &&
                row.original.paymentProvider &&
                refundProviders.includes(row.original.paymentProvider)
                  ? row.original.paymentProvider
                  : null
              }
              trigger={
                <Button
                  size="sm"
                  aria-label={t('refunds.complete.openFor', { code: row.original.orderCode })}
                >
                  {t('refunds.complete.open')}
                </Button>
              }
            />
          ),
      },
    ],
    [t, tReturns, format, refundProviders],
  );
  return (
    <DataTable
      columns={columns}
      data={props.rows}
      total={props.total}
      page={props.page}
      pageSize={props.pageSize}
      getRowId={(row) => row.id}
      caption={t('refunds.title')}
      filters={
        <FilterSelect
          param="filter"
          label={t('refunds.filter.label')}
          allLabel={t('refunds.filter.open')}
          options={[
            { value: 'completed', label: t('refunds.filter.completed') },
            { value: 'all', label: t('refunds.filter.all') },
          ]}
        />
      }
      emptyTitle={t('refunds.empty')}
    />
  );
}
