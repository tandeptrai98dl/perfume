'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useTransition } from 'react';
import { toast } from 'sonner';

import { setProductStatusAction } from '@/actions/admin/products';
import { Button } from '@/components/ui/button';
import type { ProductListRow } from '@/server/modules/catalog';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { StatusBadge } from '../status-badge';
import { TranslationStatusBadge } from '../translation-status-badge';

const VND = { style: 'currency', currency: 'VND', maximumFractionDigits: 0 } as const;

export function ProductTable({
  rows,
  total,
  page,
  pageSize,
  brands,
}: {
  rows: ProductListRow[];
  total: number;
  page: number;
  pageSize: number;
  brands: { id: string; name: string }[];
}) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const [pending, startTransition] = useTransition();

  const columns = useMemo<DataTableColumn<ProductListRow>[]>(
    () => [
      {
        id: 'name',
        header: t('products.columns.name'),
        cell: ({ row }) => (
          <Link
            href={`/admin/products/${row.original.id}` as Route}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'brand',
        header: t('products.columns.brand'),
        cell: ({ row }) => row.original.brandName,
      },
      {
        id: 'concentration',
        header: t('products.columns.concentration'),
        cell: ({ row }) => row.original.concentration.toUpperCase(),
      },
      {
        id: 'status',
        header: t('products.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'english',
        header: t('products.columns.english'),
        cell: ({ row }) => <TranslationStatusBadge locale="en" status={row.original.enStatus} />,
      },
      {
        id: 'minPrice',
        header: t('products.columns.price'),
        cell: ({ row }) =>
          row.original.minPrice === null ? (
            '—'
          ) : (
            <span className="tabular-nums">{format.number(row.original.minPrice, VND)}</span>
          ),
      },
      {
        id: 'stock',
        header: t('products.columns.stock'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.stock}</span>,
      },
      {
        id: 'updatedAt',
        header: t('products.columns.updated'),
        cell: ({ row }) =>
          format.dateTime(row.original.updatedAt, { dateStyle: 'short', timeStyle: 'short' }),
      },
    ],
    [t, format],
  );

  function bulkStatus(ids: string[], status: 'draft' | 'archived', clear: () => void) {
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => setProductStatusAction({ id, status })));
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) toast.error(t('products.bulk.failed', { count: failed }));
      if (failed < ids.length)
        toast.success(t('products.bulk.done', { count: ids.length - failed }));
      clear();
    });
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('products.title')}
      sortable={{
        name: 'name',
        brand: 'brand',
        minPrice: 'minPrice',
        stock: 'stock',
        updatedAt: 'updatedAt',
      }}
      searchLabel={t('products.search')}
      filters={
        <>
          <FilterSelect
            param="status"
            label={t('products.filters.status')}
            allLabel={t('products.filters.allStatuses')}
            options={(['draft', 'active', 'archived'] as const).map((value) => ({
              value,
              label: t(`status.${value}`),
            }))}
          />
          <FilterSelect
            param="brand"
            label={t('products.filters.brand')}
            allLabel={t('products.filters.allBrands')}
            options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
          />
        </>
      }
      bulkActions={(ids, clear) => (
        <>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => bulkStatus(ids, 'draft', clear)}
          >
            {t('products.bulk.draft')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => bulkStatus(ids, 'archived', clear)}
          >
            {t('products.bulk.archive')}
          </Button>
        </>
      )}
      emptyTitle={t('products.empty')}
    />
  );
}
