'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';

import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import type { CheckoutFormValues } from '@/lib/checkout/form-schema';

import { CheckoutFieldMessage } from './field-message';
import type { CheckoutQuote } from './types';

/** Delivery options for the chosen province and parcel weight, with ETA (§10.4). */
export function ShippingMethodPicker({
  options,
  provinceChosen,
  merchandiseTotal,
  freeShippingCoupon,
  label,
}: {
  options: CheckoutQuote['shippingOptions'];
  provinceChosen: boolean;
  /** Subtotal after discounts, to show which rates are free for this order. */
  merchandiseTotal: number;
  freeShippingCoupon: boolean;
  label: string;
}) {
  const t = useTranslations('checkout.shipping');
  const format = useFormatter();
  const form = useFormContext<CheckoutFormValues>();

  if (!provinceChosen) return <p className="text-small text-taupe-600">{t('chooseProvince')}</p>;
  if (options.length === 0) return <p className="text-small text-warning">{t('none')}</p>;

  return (
    <FormField
      control={form.control}
      name="shippingRateId"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <RadioGroup
              aria-label={label}
              value={field.value}
              onValueChange={(value) => field.onChange(value)}
              onBlur={field.onBlur}
            >
              {options.map((option) => {
                const free =
                  freeShippingCoupon ||
                  (option.freeOverSubtotal !== null && merchandiseTotal >= option.freeOverSubtotal);
                const eta =
                  option.etaMinDays === option.etaMaxDays
                    ? t('etaSame', { days: option.etaMaxDays })
                    : t('eta', { min: option.etaMinDays, max: option.etaMaxDays });
                const description =
                  option.freeOverSubtotal !== null && !free
                    ? `${eta} · ${t('freeOver', { amount: format.number(option.freeOverSubtotal, 'vnd') })}`
                    : eta;
                return (
                  <RadioCard
                    key={option.rateId}
                    value={option.rateId}
                    title={option.name}
                    description={description}
                    aside={
                      <span className="tabular-nums">
                        {free ? t('free') : format.number(option.fee, 'vnd')}
                      </span>
                    }
                  />
                );
              })}
            </RadioGroup>
          </FormControl>
          <CheckoutFieldMessage />
        </FormItem>
      )}
    />
  );
}
