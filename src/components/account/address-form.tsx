'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { saveAddressAction } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { addressSchema } from '@/lib/validation/account';

import { AccountFormMessage, FormNotice, useAccountError } from './form-message';

export type AdminUnitOption = { code: string; name: string; nameAscii: string };

export type AddressFormValues = z.input<typeof addressSchema>;

/** English forms show names without diacritics (§10.7); search accepts both forms. */
function toOptions(units: AdminUnitOption[], locale: string): ComboboxOption[] {
  return units.map((unit) => ({
    value: unit.code,
    label: locale === 'en' ? unit.nameAscii : unit.name,
    keywords: [unit.name, unit.nameAscii],
  }));
}

/**
 * AddressForm (§8.3): province → ward (2-level units), Vietnamese phone validation. Wards are
 * loaded per province from `/api/geo/wards` (cached reference data).
 */
export function AddressForm({
  provinces,
  initial,
  addressId,
  onSaved,
}: {
  provinces: AdminUnitOption[];
  initial?: AddressFormValues;
  addressId?: string;
  onSaved: () => void;
}) {
  const t = useTranslations('account.addresses');
  const locale = useLocale();
  const errorMessage = useAccountError();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AddressFormValues, unknown, z.output<typeof addressSchema>>({
    resolver: zodResolver(addressSchema),
    defaultValues: initial ?? {
      fullName: '',
      phone: '',
      provinceCode: '',
      wardCode: '',
      street: '',
      isDefault: false,
    },
  });
  const provinceCode = useWatch({ control: form.control, name: 'provinceCode' });
  const [wards, setWards] = useState<{ province: string; units: AdminUnitOption[] } | null>(null);
  const [wardsFailed, setWardsFailed] = useState(false);

  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    fetch(`/api/geo/wards?province=${encodeURIComponent(provinceCode)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ wards: AdminUnitOption[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setWardsFailed(false);
        setWards({ province: provinceCode, units: data.wards });
      })
      .catch(() => {
        if (!cancelled) setWardsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [provinceCode]);

  const provinceOptions = useMemo(() => toOptions(provinces, locale), [provinces, locale]);
  const wardOptions = useMemo(
    () => (wards && wards.province === provinceCode ? toOptions(wards.units, locale) : []),
    [wards, provinceCode, locale],
  );

  async function onSubmit(values: z.output<typeof addressSchema>) {
    setFormError(null);
    const result = await saveAddressAction({ id: addressId, values });
    if (result.ok) {
      onSaved();
      return;
    }
    let shown = false;
    for (const issue of result.fieldErrors) {
      const path = issue.path.replace(/^values\./, '') as keyof AddressFormValues;
      if (path && path in form.getValues()) {
        form.setError(path, { type: 'server', message: issue.code });
        shown = true;
      } else {
        setFormError(errorMessage(issue.code));
        shown = true;
      }
    }
    if (!shown) setFormError(errorMessage(result.error));
  }

  return (
    <Form {...form}>
      <form
        method="post"
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-5"
        noValidate
      >
        {formError && <FormNotice tone="error">{formError}</FormNotice>}
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.fullName')}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.phone')}</FormLabel>
              <FormControl>
                <Input type="tel" autoComplete="tel" inputMode="tel" {...field} />
              </FormControl>
              <FormDescription>{t('fields.phoneHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="provinceCode"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{t('fields.province')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={provinceOptions}
                    value={field.value || null}
                    onValueChange={(value) => {
                      field.onChange(value ?? '');
                      form.setValue('wardCode', '', { shouldValidate: false });
                    }}
                    placeholder={t('fields.provincePlaceholder')}
                    searchPlaceholder={t('fields.search')}
                    emptyText={t('fields.noResults')}
                    invalid={!!fieldState.error}
                  />
                </FormControl>
                <AccountFormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="wardCode"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{t('fields.ward')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={wardOptions}
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? '')}
                    placeholder={provinceCode ? t('fields.wardPlaceholder') : t('fields.wardFirst')}
                    searchPlaceholder={t('fields.search')}
                    emptyText={t('fields.noResults')}
                    disabled={!provinceCode || wardOptions.length === 0}
                    invalid={!!fieldState.error}
                  />
                </FormControl>
                {wardsFailed && <p className="text-small text-danger">{t('wardsFailed')}</p>}
                <AccountFormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="street"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.street')}</FormLabel>
              <FormControl>
                <Input autoComplete="street-address" {...field} />
              </FormControl>
              <FormDescription>{t('fields.streetHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <FormItem className="flex-row items-center gap-3">
              <FormControl>
                <Checkbox
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              </FormControl>
              <FormLabel className="min-h-11 content-center">{t('fields.isDefault')}</FormLabel>
            </FormItem>
          )}
        />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('save')}
        </Button>
      </form>
    </Form>
  );
}
