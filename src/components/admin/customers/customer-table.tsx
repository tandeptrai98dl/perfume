'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';

export type CustomerRowView = {
  key: string;
  type: 'registered' | 'guest';
  name: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
  lifetimeSpend: number;
  lastOrderAt: string | null;
  failedDeliveries: number;
  codRiskFlag: boolean;
  since: string;
};

const DATE = { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' } as const;
const VND = { style: 'currency', currency: 'VND', maximumFractionDigits: 0 } as const;

/** Customer list (§11.2 "Customers"): registered accounts and guest contacts. */
export function CustomerTable(props: {
  rows: CustomerRowView[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.customers');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<CustomerRowView>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <Link
              href={`/admin/customers/${row.original.key}` as Route}
              prefetch={false}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name || t('noName')}
            </Link>
            <span className="text-taupe-600">
              {row.original.type === 'registered' ? t('type.registered') : t('type.guest')}
            </span>
          </span>
        ),
      },
      {
        id: 'contact',
        header: t('columns.contact'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="tabular-nums">{row.original.phone ?? '—'}</span>
            <span className="break-all text-taupe-600">{row.original.email ?? '—'}</span>
          </span>
        ),
      },
      {
        id: 'orders',
        header: t('columns.orders'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.orderCount}</span>,
      },
      {
        id: 'spend',
        header: t('columns.spend'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.number(row.original.lifetimeSpend, VND)}</span>
        ),
      },
      {
        id: 'lastOrder',
        header: t('columns.lastOrder'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.lastOrderAt
              ? format.dateTime(new Date(row.original.lastOrderAt), DATE)
              : '—'}
          </span>
        ),
      },
      {
        id: 'risk',
        header: t('columns.risk'),
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.codRiskFlag && <Badge variant="warning">{t('risk.flagged')}</Badge>}
            {row.original.failedDeliveries > 0 && (
              <Badge variant="outline">
                {t('risk.failed', { count: row.original.failedDeliveries })}
              </Badge>
            )}
            {!row.original.codRiskFlag && row.original.failedDeliveries === 0 && (
              <span className="text-taupe-600">—</span>
            )}
          </span>
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
      getRowId={(row) => row.key}
      caption={t('title')}
      searchLabel={t('search')}
      sortable={{ name: 'name', orders: 'orders', spend: 'spend', lastOrder: 'lastOrder' }}
      filters={
        <>
          <FilterSelect
            param="type"
            label={t('filter.type')}
            allLabel={t('filter.allTypes')}
            options={[
              { value: 'registered', label: t('type.registered') },
              { value: 'guest', label: t('type.guest') },
            ]}
          />
          <FilterSelect
            param="risk"
            label={t('filter.risk')}
            allLabel={t('filter.allRisk')}
            options={[{ value: 'flagged', label: t('filter.flagged') }]}
          />
        </>
      }
      emptyTitle={t('empty')}
    />
  );
}
