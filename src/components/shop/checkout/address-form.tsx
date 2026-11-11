'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { listWardsAction } from '@/actions/checkout';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { CheckoutFormValues } from '@/lib/checkout/form-schema';
import { cn } from '@/lib/utils';

import { CheckoutFieldMessage } from './field-message';
import type { AdminUnit } from './types';

/*
 * Two-level Vietnamese address (province → ward, 2025 units) with accent-insensitive search.
 * English UIs show names without diacritics (§10.7); both spellings match in either locale.
 */

export type WardDirectory = {
  wardsOf: (provinceCode: string) => AdminUnit[] | undefined;
  load: (provinceCode: string) => Promise<AdminUnit[]>;
};

/** Per-page cache of ward lists, loaded on demand by province. */
export function useWardDirectory(initial: Record<string, AdminUnit[]> = {}): WardDirectory {
  const [cache, setCache] = useState<Record<string, AdminUnit[]>>(initial);
  const pending = useRef(new Map<string, Promise<AdminUnit[]>>());

  const load = useCallback(
    (provinceCode: string) => {
      const cached = cache[provinceCode];
      if (cached) return Promise.resolve(cached);
      let request = pending.current.get(provinceCode);
      if (!request) {
        request = listWardsAction({ provinceCode }).then((result) => {
          pending.current.delete(provinceCode);
          const wards = result.ok ? result.wards : [];
          if (result.ok) setCache((current) => ({ ...current, [provinceCode]: wards }));
          return wards;
        });
        pending.current.set(provinceCode, request);
      }
      return request;
    },
    [cache],
  );

  return { wardsOf: (code) => cache[code], load };
}

export function useUnitOptions(units: readonly AdminUnit[] | undefined): ComboboxOption[] {
  const locale = useLocale();
  return useMemo(
    () =>
      (units ?? []).map((unit) =>
        locale === 'vi'
          ? { value: unit.code, label: unit.name, keywords: [unit.nameAscii] }
          : { value: unit.code, label: unit.nameAscii, keywords: [unit.name] },
      ),
    [units, locale],
  );
}

type AddressPrefix = 'address' | 'vatInvoice.address';

export function AddressForm({
  prefix,
  provinces,
  wards,
  className,
}: {
  prefix: AddressPrefix;
  provinces: AdminUnit[];
  wards: WardDirectory;
  className?: string;
}) {
  const t = useTranslations('checkout.address');
  const form = useFormContext<CheckoutFormValues>();
  const provinceCode = useWatch({ control: form.control, name: `${prefix}.provinceCode` });
  const [loading, setLoading] = useState(false);
  const provinceOptions = useUnitOptions(provinces);
  const wardList = provinceCode ? wards.wardsOf(provinceCode) : undefined;
  const wardOptions = useUnitOptions(wardList);

  async function changeProvince(code: string | null) {
    form.setValue(`${prefix}.provinceCode`, code ?? '', {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
    form.setValue(`${prefix}.wardCode`, '', { shouldDirty: true });
    if (code && !wards.wardsOf(code)) {
      setLoading(true);
      await wards.load(code);
      setLoading(false);
    }
  }

  const wardPlaceholder = !provinceCode
    ? t('wardChooseProvince')
    : loading || !wardList
      ? t('wardLoading')
      : t('wardPlaceholder');

  return (
    <div className={cn('grid gap-5 md:grid-cols-2', className)}>
      <FormField
        control={form.control}
        name={`${prefix}.provinceCode`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('province')}</FormLabel>
            <FormControl>
              <Combobox
                options={provinceOptions}
                value={field.value || null}
                onValueChange={(code) => void changeProvince(code)}
                placeholder={t('provincePlaceholder')}
                searchPlaceholder={t('provinceSearch')}
                emptyText={t('noResults')}
                invalid={!!fieldState.error}
              />
            </FormControl>
            <CheckoutFieldMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.wardCode`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('ward')}</FormLabel>
            <FormControl>
              <Combobox
                options={wardOptions}
                value={field.value || null}
                onValueChange={(code) =>
                  form.setValue(`${prefix}.wardCode`, code ?? '', {
                    shouldDirty: true,
                    shouldValidate: form.formState.isSubmitted,
                  })
                }
                placeholder={wardPlaceholder}
                searchPlaceholder={t('wardSearch')}
                emptyText={t('noResults')}
                disabled={!provinceCode || !wardList}
                invalid={!!fieldState.error}
              />
            </FormControl>
            <CheckoutFieldMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.street`}
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>{t('street')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete={prefix === 'address' ? 'shipping street-address' : 'street-address'}
                required
              />
            </FormControl>
            <FormDescription>{t('streetHint')}</FormDescription>
            <CheckoutFieldMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
