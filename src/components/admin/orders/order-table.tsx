'use client';

import { Printer, TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { bulkConfirmOrdersAction } from '@/actions/admin/orders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  AdminOrderRow,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/server/modules/order';

import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { useActionFeedback } from '../form/action-feedback';
import { DateRangeFilter } from './date-range-filter';
import { OrderStatusBadge, PaymentStatusBadge } from './order-badges';
import { useOrderFormat } from './format';

const ORDER_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'returned',
] as const satisfies readonly OrderStatus[];
const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const satisfies readonly PaymentStatus[];
const PAYMENT_METHODS = [
  'cod',
  'vnpay',
  'payos',
  'bank_transfer',
  'momo',
  'zalopay',
] as const satisfies readonly PaymentMethod[];

function printHref(document: 'packing-slip' | 'delivery-slip', ids: string[]) {
  return `/admin/orders/print/${document}?ids=${ids.join(',')}` as Route;
}

/** Orders list (§11.2): filters in the URL, bulk confirm (COD) and bulk print. */
export function OrderTable({
  rows,
  total,
  page,
  pageSize,
  provinces,
}: {
  rows: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  provinces: { code: string; name: string }[];
}) {
  const t = useTranslations('admin.orders');
  const feedback = useActionFeedback();
  const format = useOrderFormat();

  const columns = useMemo<DataTableColumn<AdminOrderRow>[]>(
    () => [
      {
        id: 'code',
        header: t('columns.code'),
        cell: ({ row }) => (
          <Link
            href={`/admin/orders/${row.original.id}` as Route}
            className="font-mono font-medium underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'placedAt',
        header: t('columns.placedAt'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {format.dateTime(row.original.placedAt)}
          </span>
        ),
      },
      {
        id: 'customer',
        header: t('columns.customer'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{row.original.customerName}</span>
            <span className="text-taupe-600 tabular-nums">{row.original.phone}</span>
            {row.original.codRisk && (
              <Badge variant="warning" className="mt-1 w-fit">
                <TriangleAlert aria-hidden />
                {t('codRisk')}
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: 'province',
        header: t('columns.province'),
        cell: ({ row }) => row.original.provinceName ?? '—',
      },
      {
        id: 'items',
        header: t('columns.items'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span>,
      },
      {
        id: 'total',
        header: t('columns.total'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">{format.vnd(row.original.total)}</span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
      },
      {
        id: 'payment',
        header: t('columns.payment'),
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            <PaymentStatusBadge status={row.original.paymentStatus} />
            <span className="text-taupe-600">
              {t(`paymentMethod.${row.original.paymentMethod}`)}
            </span>
          </span>
        ),
      },
    ],
    [t, format],
  );

  async function confirmSelected(ids: string[], clear: () => void) {
    const result = await bulkConfirmOrdersAction({ orderIds: ids });
    if (!result.ok) {
      feedback.fail(result);
      return false;
    }
    const { confirmed, skipped } = result.data;
    if (confirmed.length > 0) feedback.success(t('bulk.confirmed', { count: confirmed.length }));
    if (skipped.length > 0) {
      toast.error(
        t('bulk.skipped', { codes: skipped.map((s) => s.code ?? s.orderId).join(', ') }),
        {
          description: feedback.message(skipped[0]!.reason),
        },
      );
    }
    clear();
    return true;
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('title')}
      sortable={{ code: 'code', placedAt: 'placedAt', total: 'total' }}
      searchLabel={t('search')}
      filters={
        <>
          <FilterSelect
            param="status"
            label={t('filters.status')}
            allLabel={t('filters.all')}
            options={ORDER_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          />
          <FilterSelect
            param="paymentStatus"
            label={t('filters.paymentStatus')}
            allLabel={t('filters.all')}
            options={PAYMENT_STATUSES.map((value) => ({
              value,
              label: t(`paymentStatus.${value}`),
            }))}
          />
          <FilterSelect
            param="paymentMethod"
            label={t('filters.paymentMethod')}
            allLabel={t('filters.all')}
            options={PAYMENT_METHODS.map((value) => ({
              value,
              label: t(`paymentMethod.${value}`),
            }))}
          />
          <FilterSelect
            param="province"
            label={t('filters.province')}
            allLabel={t('filters.all')}
            options={provinces.map((province) => ({ value: province.code, label: province.name }))}
          />
          <DateRangeFilter />
        </>
      }
      bulkActions={(ids, clear) => (
        <>
          <ConfirmDialog
            trigger={<Button size="sm">{t('bulk.confirm')}</Button>}
            title={t('bulk.confirmTitle', { count: ids.length })}
            description={t('bulk.confirmDescription')}
            confirmLabel={t('bulk.confirm')}
            destructive={false}
            onConfirm={() => confirmSelected(ids, clear)}
          />
          <Button asChild variant="secondary" size="sm">
            <a href={printHref('packing-slip', ids)} target="_blank" rel="noopener">
              <Printer aria-hidden />
              {t('bulk.printPacking')}
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={printHref('delivery-slip', ids)} target="_blank" rel="noopener">
              <Printer aria-hidden />
              {t('bulk.printDelivery')}
            </a>
          </Button>
        </>
      )}
      emptyTitle={t('empty')}
    />
  );
}
