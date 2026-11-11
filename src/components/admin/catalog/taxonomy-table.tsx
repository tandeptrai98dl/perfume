'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import type { TaxonomyKind, TaxonomyRow } from '@/server/modules/catalog';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { TranslationStatusBadge } from '../translation-status-badge';

const BASE: Record<TaxonomyKind, string> = {
  family: '/admin/catalog/families',
  note: '/admin/catalog/notes',
};

/** Scent families and notes share one list. */
export function TaxonomyTable({
  kind,
  rows,
  total,
  page,
  pageSize,
}: {
  kind: TaxonomyKind;
  rows: TaxonomyRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.taxonomy');
  const columns = useMemo<DataTableColumn<TaxonomyRow>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        cell: ({ row }) => (
          <Link
            href={`${BASE[kind]}/${row.original.id}` as Route}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'enName',
        header: t('columns.enName'),
        cell: ({ row }) =>
          row.original.enName ?? <TranslationStatusBadge locale="en" status="missing" />,
      },
      {
        id: 'slug',
        header: t('columns.slug'),
        cell: ({ row }) => <span className="font-mono">{row.original.slug}</span>,
      },
      {
        id: 'productCount',
        header: t('columns.products'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
      },
    ],
    [t, kind],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t(`${kind}.title`)}
      sortable={{ name: 'name', productCount: 'productCount' }}
      searchLabel={t('search')}
      emptyTitle={t(`${kind}.empty`)}
    />
  );
}
