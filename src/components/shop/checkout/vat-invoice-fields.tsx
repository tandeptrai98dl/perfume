'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CheckoutFormValues } from '@/lib/checkout/form-schema';

import { AddressForm, type WardDirectory } from './address-form';
import { CheckoutFieldMessage } from './field-message';
import type { AdminUnit } from './types';

/** Optional company VAT invoice details (D13), collapsed unless requested. */
export function VatInvoiceFields({
  provinces,
  wards,
}: {
  provinces: AdminUnit[];
  wards: WardDirectory;
}) {
  const t = useTranslations('checkout.vat');
  const form = useFormContext<CheckoutFormValues>();
  const requested = useWatch({ control: form.control, name: 'vatInvoice.requested' });
  const toggleId = useId();
  const panelId = useId();
  const legendId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={toggleId}
          checked={requested}
          aria-controls={requested ? panelId : undefined}
          onCheckedChange={(checked) =>
            form.setValue('vatInvoice.requested', checked === true, { shouldDirty: true })
          }
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={toggleId}>{t('toggle')}</Label>
          <p className="text-small text-taupe-600">{t('hint')}</p>
        </div>
      </div>
      {requested && (
        <div id={panelId} className="border-line-200 grid gap-5 border-l pl-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="vatInvoice.companyName"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>{t('companyName')}</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="organization" />
                </FormControl>
                <CheckoutFieldMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vatInvoice.taxCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('taxCode')}</FormLabel>
                <FormControl>
                  <Input {...field} inputMode="numeric" autoComplete="off" />
                </FormControl>
                <FormDescription>{t('taxCodeHint')}</FormDescription>
                <CheckoutFieldMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vatInvoice.email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('email')}</FormLabel>
                <FormControl>
                  <Input {...field} type="email" inputMode="email" autoCapitalize="none" />
                </FormControl>
                <CheckoutFieldMessage />
              </FormItem>
            )}
          />
          <div
            role="group"
            aria-labelledby={legendId}
            className="flex flex-col gap-3 md:col-span-2"
          >
            <p id={legendId} className="text-small font-medium">
              {t('addressLegend')}
            </p>
            <AddressForm prefix="vatInvoice.address" provinces={provinces} wards={wards} />
          </div>
        </div>
      )}
    </div>
  );
}
