'use client';

import { useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';

import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { CheckoutFormValues } from '@/lib/checkout/form-schema';

import { CheckoutFieldMessage } from './field-message';

/** Contact block: email (confirmations) and Vietnamese mobile number (courier, §10.4). */
export function ContactSection() {
  const t = useTranslations('checkout.contact');
  const form = useFormContext<CheckoutFormValues>();
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('email')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </FormControl>
            <FormDescription>{t('emailHint')}</FormDescription>
            <CheckoutFieldMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('phone')}</FormLabel>
            <FormControl>
              <Input {...field} type="tel" inputMode="tel" autoComplete="tel-national" required />
            </FormControl>
            <FormDescription>{t('phoneHint')}</FormDescription>
            <CheckoutFieldMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
