'use client';

import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { deleteProductLineAction, saveProductLineAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import type { ProductLineRow } from '@/server/modules/catalog';

import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { useActionFeedback } from '../form/action-feedback';
import { SelectField, TextField } from '../form/fields';

type LineForm = { brandId: string; name: string };
type Editing = { id: string | null; values: LineForm } | null;

export function ProductLineManager({
  rows,
  total,
  page,
  pageSize,
  brands,
}: {
  rows: ProductLineRow[];
  total: number;
  page: number;
  pageSize: number;
  brands: { id: string; name: string }[];
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<LineForm>({ defaultValues: { brandId: '', name: '' } });

  function open(next: NonNullable<Editing>) {
    form.reset(next.values);
    setEditing(next);
  }

  const columns = useMemo<DataTableColumn<ProductLineRow>[]>(
    () => [
      { id: 'name', header: t('productLines.columns.name'), cell: ({ row }) => row.original.name },
      {
        id: 'brand',
        header: t('productLines.columns.brand'),
        cell: ({ row }) => row.original.brandName,
      },
      {
        id: 'products',
        header: t('productLines.columns.products'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('table.actions')}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <IconButton
              aria-label={`${t('form.edit')} ${row.original.name}`}
              onClick={() =>
                open({
                  id: row.original.id,
                  values: { brandId: row.original.brandId, name: row.original.name },
                })
              }
            >
              <Pencil aria-hidden />
            </IconButton>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  {t('form.delete')}
                </Button>
              }
              title={t('productLines.deleteTitle', { name: row.original.name })}
              description={t('productLines.deleteDescription')}
              confirmLabel={t('form.delete')}
              onConfirm={async () => {
                const result = await deleteProductLineAction({ id: row.original.id });
                if (!result.ok) {
                  feedback.fail(result);
                  return false;
                }
                feedback.success(t('form.deleted'));
              }}
            />
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` only uses stable setters
    [t, feedback, router],
  );

  function submit(values: LineForm) {
    if (!editing) return;
    startTransition(async () => {
      const result = await saveProductLineAction({ id: editing.id, input: values });
      if (!result.ok) {
        feedback.applyFieldErrors(form, result, 'input.');
        feedback.fail(result);
        return;
      }
      feedback.success(editing.id ? t('form.saved') : t('form.created'));
      setEditing(null);
    });
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => open({ id: null, values: { brandId: brands[0]?.id ?? '', name: '' } })}
        >
          <Plus aria-hidden />
          {t('productLines.new')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        getRowId={(row) => row.id}
        caption={t('productLines.title')}
        sortable={{ name: 'name', brand: 'brand' }}
        searchLabel={t('productLines.search')}
        filters={
          <FilterSelect
            param="brand"
            label={t('productLines.fields.brand')}
            allLabel={t('products.filters.allBrands')}
            options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
          />
        }
        emptyTitle={t('productLines.empty')}
      />
      <Dialog open={!!editing} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="bg-white" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-h3">
              {editing?.id ? t('productLines.editTitle') : t('productLines.new')}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
              <SelectField<LineForm>
                name="brandId"
                label={t('productLines.fields.brand')}
                options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              />
              <TextField<LineForm> name="name" label={t('productLines.fields.name')} required />
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  {t('form.cancel')}
                </Button>
                <Button type="submit" loading={pending}>
                  {t('form.save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
