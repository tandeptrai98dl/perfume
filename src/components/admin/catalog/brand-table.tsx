'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import type { BrandListRow } from '@/server/modules/catalog';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { StatusBadge } from '../status-badge';
import { TranslationStatusBadge } from '../translation-status-badge';

export function BrandTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: BrandListRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<BrandListRow>[]>(
    () => [
      {
        id: 'name',
        header: t('brands.columns.name'),
        cell: ({ row }) => (
          <Link
            href={`/admin/catalog/brands/${row.original.id}` as Route}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'country',
        header: t('brands.columns.country'),
        cell: ({ row }) => row.original.country ?? '—',
      },
      {
        id: 'status',
        header: t('brands.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'translations',
        header: t('brands.columns.translations'),
        cell: ({ row }) => (
          <span className="flex gap-1">
            <TranslationStatusBadge locale="vi" status={row.original.viStatus} compact />
            <TranslationStatusBadge locale="en" status={row.original.enStatus} compact />
          </span>
        ),
      },
      {
        id: 'productCount',
        header: t('brands.columns.products'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
      },
      {
        id: 'updatedAt',
        header: t('brands.columns.updated'),
        cell: ({ row }) =>
          format.dateTime(row.original.updatedAt, { dateStyle: 'short', timeStyle: 'short' }),
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
      caption={t('brands.title')}
      sortable={{ name: 'name', productCount: 'productCount', updatedAt: 'updatedAt' }}
      searchLabel={t('brands.search')}
      filters={
        <FilterSelect
          param="status"
          label={t('brands.fields.status')}
          allLabel={t('brands.allStatuses')}
          options={(['draft', 'active', 'archived'] as const).map((value) => ({
            value,
            label: t(`status.${value}`),
          }))}
        />
      }
      emptyTitle={t('brands.empty')}
    />
  );
}
