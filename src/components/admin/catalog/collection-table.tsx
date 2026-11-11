'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import type { CollectionRow } from '@/server/modules/catalog';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { StatusBadge } from '../status-badge';
import { TranslationStatusBadge } from '../translation-status-badge';

export function CollectionTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: CollectionRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<CollectionRow>[]>(() => {
    const date = (value: Date | null) =>
      value ? format.dateTime(value, { dateStyle: 'short' }) : '…';
    return [
      {
        id: 'name',
        header: t('collections.columns.name'),
        cell: ({ row }) => (
          <Link
            href={`/admin/catalog/collections/${row.original.id}` as Route}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('collections.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'visible' : 'hidden'} />,
      },
      {
        id: 'schedule',
        header: t('collections.columns.schedule'),
        cell: ({ row }) =>
          row.original.startsAt || row.original.endsAt
            ? `${date(row.original.startsAt)} – ${date(row.original.endsAt)}`
            : t('collections.always'),
      },
      {
        id: 'translations',
        header: t('collections.columns.translations'),
        cell: ({ row }) => (
          <span className="flex gap-1">
            <TranslationStatusBadge locale="vi" status={row.original.viStatus} compact />
            <TranslationStatusBadge locale="en" status={row.original.enStatus} compact />
          </span>
        ),
      },
      {
        id: 'products',
        header: t('collections.columns.products'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
      },
    ];
  }, [t, format]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('collections.title')}
      sortable={{ name: 'name' }}
      searchLabel={t('collections.search')}
      emptyTitle={t('collections.empty')}
    />
  );
}
