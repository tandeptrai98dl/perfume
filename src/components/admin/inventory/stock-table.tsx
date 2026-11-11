'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import type { StockRow } from '@/server/modules/inventory';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { StatusBadge } from '../status-badge';
import { StockAdjustDialog } from './stock-adjust-dialog';

/** Stock per variant: on hand / reserved (0 until orders, M2) / available (§11.2). */
export function StockTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: StockRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin');
  const columns = useMemo<DataTableColumn<StockRow>[]>(
    () => [
      {
        id: 'product',
        header: t('inventory.columns.product'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <Link
              href={`/admin/products/${row.original.productId}` as Route}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.productName}
            </Link>
            <span className="text-taupe-600">
              {row.original.brandName} · {row.original.sizeMl} ml
            </span>
          </span>
        ),
      },
      {
        id: 'sku',
        header: t('inventory.columns.sku'),
        cell: ({ row }) => (
          <Link
            href={`/admin/inventory/movements?variant=${row.original.variantId}` as Route}
            className="font-mono underline-offset-4 hover:underline"
          >
            {row.original.sku}
          </Link>
        ),
      },
      {
        id: 'onHand',
        header: t('inventory.columns.onHand'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.onHand}</span>,
      },
      {
        id: 'reserved',
        header: t('inventory.columns.reserved'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.reserved}</span>,
      },
      {
        id: 'available',
        header: t('inventory.columns.available'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">{row.original.available}</span>
        ),
      },
      {
        id: 'status',
        header: t('inventory.columns.status'),
        cell: ({ row }) =>
          !row.original.isActive ? (
            <StatusBadge status="inactive" />
          ) : row.original.available === 0 ? (
            <StatusBadge status="out" />
          ) : row.original.isLow ? (
            <StatusBadge status="low" />
          ) : null,
      },
      {
        id: 'threshold',
        header: t('inventory.columns.threshold'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.lowStockThreshold}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('table.actions')}</span>,
        cell: ({ row }) => (
          <StockAdjustDialog
            target={row.original}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('inventory.adjust.openFor', { sku: row.original.sku })}
              >
                {t('inventory.adjust.open')}
              </Button>
            }
          />
        ),
      },
    ],
    [t],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.variantId}
      caption={t('inventory.title')}
      sortable={{ product: 'product', sku: 'sku', onHand: 'onHand', available: 'available' }}
      searchLabel={t('inventory.search')}
      filters={
        <FilterSelect
          param="stock"
          label={t('inventory.filter.label')}
          allLabel={t('inventory.filter.all')}
          options={[{ value: 'low', label: t('inventory.filter.low') }]}
        />
      }
      emptyTitle={t('inventory.empty')}
    />
  );
}
