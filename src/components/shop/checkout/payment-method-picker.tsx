'use client';

import { Banknote, CreditCard, QrCode, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';

import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  CHECKOUT_PAYMENT_METHODS,
  type CheckoutFormValues,
  type CheckoutPaymentMethod,
} from '@/lib/checkout/form-schema';

import { CheckoutFieldMessage } from './field-message';

const ICONS: Record<CheckoutPaymentMethod, LucideIcon> = {
  cod: Banknote,
  payos: QrCode,
  vnpay: CreditCard,
};

/** COD, VietQR (payOS) and VNPay (§10.4). The gateway step happens on the result page. */
export function PaymentMethodPicker({ label }: { label: string }) {
  const t = useTranslations('checkout.payment.methods');
  const form = useFormContext<CheckoutFormValues>();
  return (
    <FormField
      control={form.control}
      name="paymentMethod"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <RadioGroup
              aria-label={label}
              value={field.value}
              onValueChange={(value) => field.onChange(value)}
              onBlur={field.onBlur}
            >
              {CHECKOUT_PAYMENT_METHODS.map((method) => {
                const Icon = ICONS[method];
                return (
                  <RadioCard
                    key={method}
                    value={method}
                    title={t(`${method}.title`)}
                    description={t(`${method}.description`)}
                    aside={<Icon aria-hidden className="size-5 text-taupe-600" />}
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

/** COD above the threshold: 20% deposit online, balance collected by the carrier (ADR-0016). */
export function DepositNotice({
  total,
  deposit,
  threshold,
  percent,
}: {
  total: number;
  deposit: number;
  threshold: number;
  percent: number;
}) {
  const t = useTranslations('checkout.payment');
  const format = useFormatter();
  const vnd = (amount: number) => format.number(amount, 'vnd');
  return (
    <div
      role="note"
      data-testid="deposit-notice"
      className="border-gold-500 bg-sand-100 flex flex-col gap-2 border-l-2 p-4"
    >
      <p className="font-medium">{t('depositTitle')}</p>
      <p className="text-small">
        {t('depositBody', {
          threshold: vnd(threshold),
          percent,
          deposit: vnd(deposit),
          balance: vnd(total - deposit),
        })}
      </p>
      <p className="text-small text-taupe-600">{t('depositAlternative')}</p>
    </div>
  );
}
