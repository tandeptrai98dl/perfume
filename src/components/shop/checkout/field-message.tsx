'use client';

import { useTranslations } from 'next-intl';

import { FormMessage, useFormField } from '@/components/ui/form';

/** Field error translated from its code (`checkout.errors.<code>`, Zod or server). */
export function CheckoutFieldMessage() {
  const { error } = useFormField();
  const message = useCheckoutErrorMessage();
  if (!error?.message) return null;
  return <FormMessage>{message(error.message)}</FormMessage>;
}

export function useCheckoutErrorMessage() {
  const t = useTranslations('checkout.errors');
  return (code: string, values?: { name: string }) => {
    const key = code as 'invalid';
    if (!t.has(key)) return t('invalid');
    return values ? t(key as 'itemUnavailable', values) : t(key);
  };
}
