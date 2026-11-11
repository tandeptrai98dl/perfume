'use client';

import {
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import { PAGE_SIZES, tableParams } from './search-params';

export const dataTableFeatures = tableFeatures({ rowSelectionFeature });
export type DataTableColumn<T extends RowData> = ColumnDef<typeof dataTableFeatures, T>;

export type DataTableProps<T extends RowData> = {
  /** Keep stable (module scope or useMemo): TanStack rebuilds models when it changes. */
  columns: DataTableColumn<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  getRowId: (row: T) => string;
  /** Accessible table caption (visually hidden). */
  caption: string;
  /** Column id → server sort key, for sortable headers. */
  sortable?: Record<string, string>;
  /** Shows the search box with this label. */
  searchLabel?: string;
  /** Extra filters (FilterBar), rendered next to the search box. */
  filters?: ReactNode;
  /** Enables row checkboxes; renders when at least one row is selected. */
  bulkActions?: (selectedIds: string[], clear: () => void) => ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
};

/**
 * Admin list (§8.4): server-side search/sort/pagination through URL search params (nuqs,
 * non-shallow so the Server Component refetches), optional multi-select with a bulk action
 * slot. Markup is a real <table> with sortable headers announced via aria-sort.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  total,
  page,
  pageSize,
  getRowId,
  caption,
  sortable = {},
  searchLabel,
  filters,
  bulkActions,
  emptyTitle,
  emptyDescription,
}: DataTableProps<T>) {
  'use no memo';
  const t = useTranslations('admin.table');
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(tableParams, { shallow: false, startTransition });
  const [search, setSearch] = useState(params.q);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Debounced search → URL (resets to page 1).
  useEffect(() => {
    if (search === params.q) return;
    const timer = setTimeout(() => void setParams({ q: search || null, page: null }), 300);
    return () => clearTimeout(timer);
  }, [search, params.q, setParams]);

  // Selection is per page of results.
  const [dataRef, setDataRef] = useState(data);
  if (dataRef !== data) {
    setDataRef(data);
    setRowSelection({});
  }

  const selectable = !!bulkActions;
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    enableRowSelection: selectable,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  const selectedIds = Object.keys(rowSelection).filter((key) => rowSelection[key]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function toggleSort(sortKey: string) {
    const active = params.sort === sortKey;
    void setParams({
      sort: sortKey,
      dir: active && params.dir === 'asc' ? 'desc' : 'asc',
      page: null,
    });
  }

  const allSelected = table.getIsAllRowsSelected();
  const someSelected = table.getIsSomeRowsSelected();

  return (
    <div className="flex flex-col gap-4">
      {(searchLabel || filters) && (
        <div className="flex flex-wrap items-end gap-3">
          {searchLabel && (
            <div className="flex w-full max-w-sm flex-col gap-2">
              <label htmlFor={`${id}-search`} className="text-small font-medium">
                {searchLabel}
              </label>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-taupe-600"
                />
                <Input
                  id={`${id}-search`}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>
          )}
          {filters}
          <div className="ml-auto flex min-h-11 items-center" aria-live="polite">
            {pending ? (
              <span className="text-small inline-flex items-center gap-2 text-taupe-600">
                <Spinner /> {t('loading')}
              </span>
            ) : (
              <span className="text-small text-taupe-600">{t('count', { total })}</span>
            )}
          </div>
        </div>
      )}

      {selectable && selectedIds.length > 0 && (
        <div
          role="region"
          aria-label={t('bulkActions')}
          className="border-line-200 bg-sand-100 flex flex-wrap items-center gap-3 border px-4 py-2"
        >
          <span className="text-small font-medium">
            {t('selected', { count: selectedIds.length })}
          </span>
          {bulkActions(selectedIds, () => setRowSelection({}))}
          <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
            {t('clearSelection')}
          </Button>
        </div>
      )}

      <div className="border-line-200 overflow-x-auto border" aria-busy={pending || undefined}>
        <table className={cn('w-full border-collapse text-left', pending && 'opacity-60')}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-sand-100">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {selectable && (
                  <th scope="col" className="w-12 px-3 py-2">
                    <Checkbox
                      aria-label={t('selectAll')}
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
                    />
                  </th>
                )}
                {group.headers.map((header) => {
                  const sortKey = sortable[header.column.id];
                  const active = sortKey && params.sort === sortKey;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        active ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                      className="text-small px-3 py-2 font-medium whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : sortKey ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(sortKey)}
                          className="hover:text-ink-700 inline-flex min-h-9 items-center gap-1"
                        >
                          <table.FlexRender header={header} />
                          {active ? (
                            params.dir === 'asc' ? (
                              <ArrowUp aria-hidden className="size-3.5" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3.5" />
                            )
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3.5 text-taupe-600" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-line-200 data-[selected=true]:bg-sand-100 border-t"
                data-selected={row.getIsSelected() || undefined}
              >
                {selectable && (
                  <td className="px-3 py-2">
                    <Checkbox
                      aria-label={t('selectRow')}
                      checked={row.getIsSelected()}
                      onCheckedChange={(value) => row.toggleSelected(value === true)}
                    />
                  </td>
                )}
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="text-small px-3 py-2 align-middle">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-taupe-600">{t('range', { from, to, total })}</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-size`} className="text-small">
              {t('pageSize')}
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => void setParams({ pageSize: Number(value), page: null })}
            >
              <SelectTrigger id={`${id}-size`} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav aria-label={t('pagination')} className="flex items-center gap-1">
            <IconButton
              aria-label={t('previous')}
              variant="outline"
              disabled={page <= 1}
              onClick={() => void setParams({ page: page - 1 > 1 ? page - 1 : null })}
            >
              <ChevronLeft aria-hidden />
            </IconButton>
            <span className="text-small px-2 tabular-nums">{t('page', { page, totalPages })}</span>
            <IconButton
              aria-label={t('next')}
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => void setParams({ page: page + 1 })}
            >
              <ChevronRight aria-hidden />
            </IconButton>
          </nav>
        </div>
      </div>
    </div>
  );
}
