'use client';

import { Lock, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useFormContext, type Path } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import type { EditorVariant, ProductEditorValues } from './editor-values';

/** `decant` is deliberately not offered (ADR-0015). */
const VARIANT_TYPES = ['full_size', 'travel', 'tester', 'gift_set'] as const;

type NumericKey = 'sizeMl' | 'price' | 'compareAtPrice' | 'costPrice' | 'weightG';

/**
 * Sizes/types with SKU, prices (integer VND), weight and flags (§8.4). Without
 * `products.editPrices` the price columns are read-only and variants cannot be added; the
 * server enforces the same rule.
 */
export function VariantMatrixEditor({ canEditPrices }: { canEditPrices: boolean }) {
  const t = useTranslations('admin.products');
  const form = useFormContext<ProductEditorValues>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'variants',
    keyName: 'key',
  });
  const variantsError =
    form.formState.errors.variants?.root?.message ?? form.formState.errors.variants?.message;

  function numberCell(index: number, key: NumericKey, label: string, locked = false) {
    return (
      <FormField
        control={form.control}
        name={`variants.${index}.${key}` as Path<ProductEditorValues>}
        render={({ field }) => (
          <FormItem className="gap-1">
            <FormLabel className="sr-only">
              {label} – {t('variants.row', { index: index + 1 })}
            </FormLabel>
            <FormControl>
              <Input
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                readOnly={locked}
                aria-readonly={locked || undefined}
                className="read-only:bg-sand-100 min-w-28 tabular-nums"
                value={field.value === null || field.value === undefined ? '' : String(field.value)}
                onChange={(event) =>
                  field.onChange(event.target.value === '' ? null : Number(event.target.value))
                }
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  function textCell(index: number, key: 'sku' | 'barcode', label: string) {
    return (
      <FormField
        control={form.control}
        name={`variants.${index}.${key}`}
        render={({ field }) => (
          <FormItem className="gap-1">
            <FormLabel className="sr-only">
              {label} – {t('variants.row', { index: index + 1 })}
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                onChange={(event) =>
                  field.onChange(
                    key === 'sku' ? event.target.value.toUpperCase() : event.target.value,
                  )
                }
                className="min-w-32 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  const headers = [
    t('variants.sku'),
    t('variants.size'),
    t('variants.type'),
    t('variants.price'),
    t('variants.compareAt'),
    t('variants.cost'),
    t('variants.weight'),
    t('variants.barcode'),
    t('variants.default'),
    t('variants.active'),
    t('variants.stock'),
  ];

  return (
    <div className="flex flex-col gap-4">
      {!canEditPrices && (
        <p
          role="note"
          className="text-small border-line-200 bg-sand-100 flex items-center gap-2 border px-3 py-2"
        >
          <Lock aria-hidden className="size-4 shrink-0" />
          {t('variants.pricesLocked')}
        </p>
      )}
      {fields.length === 0 ? (
        <p className="text-small text-taupe-600">{t('variants.empty')}</p>
      ) : (
        <div className="border-line-200 overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t('tabs.variants')}</caption>
            <thead className="bg-sand-100">
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="text-small px-2 py-2 font-medium whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">{t('variants.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((variant, index) => {
                const saved = !!(variant as EditorVariant).id;
                return (
                  <tr key={variant.key} className="border-line-200 border-t align-top">
                    <td className="px-2 py-2">{textCell(index, 'sku', t('variants.sku'))}</td>
                    <td className="px-2 py-2">{numberCell(index, 'sizeMl', t('variants.size'))}</td>
                    <td className="px-2 py-2">
                      <FormField
                        control={form.control}
                        name={`variants.${index}.variantType`}
                        render={({ field }) => (
                          <FormItem className="gap-1">
                            <FormLabel className="sr-only">
                              {t('variants.type')} – {t('variants.row', { index: index + 1 })}
                            </FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger className="min-w-36">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {VARIANT_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {t(`variantType.${type}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {numberCell(index, 'price', t('variants.price'), !canEditPrices)}
                    </td>
                    <td className="px-2 py-2">
                      {numberCell(index, 'compareAtPrice', t('variants.compareAt'), !canEditPrices)}
                    </td>
                    <td className="px-2 py-2">
                      {numberCell(index, 'costPrice', t('variants.cost'), !canEditPrices)}
                    </td>
                    <td className="px-2 py-2">
                      {numberCell(index, 'weightG', t('variants.weight'))}
                    </td>
                    <td className="px-2 py-2">
                      {textCell(index, 'barcode', t('variants.barcode'))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <FormField
                        control={form.control}
                        name={`variants.${index}.isDefault`}
                        render={({ field }) => (
                          <FormItem className="min-h-11 items-center justify-center">
                            <FormLabel className="sr-only">
                              {t('variants.default')} – {t('variants.row', { index: index + 1 })}
                            </FormLabel>
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  if (!checked) return;
                                  form.getValues('variants').forEach((_, i) =>
                                    form.setValue(`variants.${i}.isDefault`, i === index, {
                                      shouldDirty: true,
                                    }),
                                  );
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <FormField
                        control={form.control}
                        name={`variants.${index}.isActive`}
                        render={({ field }) => (
                          <FormItem className="min-h-11 items-center justify-center">
                            <FormLabel className="sr-only">
                              {t('variants.active')} – {t('variants.row', { index: index + 1 })}
                            </FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="text-small px-2 py-2 text-right tabular-nums">
                      {saved ? ((variant as EditorVariant).onHand ?? 0) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {!saved && (
                        <IconButton
                          aria-label={`${t('variants.remove')} – ${t('variants.row', { index: index + 1 })}`}
                          onClick={() => remove(index)}
                        >
                          <X aria-hidden />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {variantsError && (
        <p role="alert" className="text-small text-danger">
          {variantsError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {canEditPrices && (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              append({
                sku: '',
                barcode: null,
                sizeMl: null,
                variantType: 'full_size',
                price: null,
                compareAtPrice: null,
                costPrice: null,
                weightG: null,
                isDefault: fields.length === 0,
                isActive: true,
              })
            }
          >
            <Plus aria-hidden />
            {t('variants.add')}
          </Button>
        )}
        <p className="text-small text-taupe-600">{t('variants.stockHint')}</p>
      </div>
    </div>
  );
}
