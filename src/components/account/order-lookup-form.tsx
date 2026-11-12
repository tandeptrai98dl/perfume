'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { lookupOrderAction } from '@/actions/order-lookup';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TurnstileWidget, useTurnstile } from '@/components/ui/turnstile-widget';
import { useRouter } from '@/i18n/navigation';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile';
import { orderLookupSchema } from '@/lib/validation/account';

import { AccountFormMessage, FormNotice } from './form-message';

/** Guest lookup (§10.5): code + phone; one generic message for any mismatch. */
export function OrderLookupForm({ defaultCode = '' }: { defaultCode?: string }) {
  const t = useTranslations('orderLookup');
  const tErrors = useTranslations('account.errors');
  const tSecurity = useTranslations('security');
  const router = useRouter();
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.orderLookup);
  const [notice, setNotice] = useState<
    'notFound' | 'rateLimited' | 'captchaFailed' | 'unexpected' | null
  >(null);
  const form = useForm<
    z.input<typeof orderLookupSchema>,
    unknown,
    z.output<typeof orderLookupSchema>
  >({
    resolver: zodResolver(orderLookupSchema),
    defaultValues: { code: defaultCode, phone: '' },
  });

  async function onSubmit(values: z.output<typeof orderLookupSchema>) {
    setNotice(null);
    const result = await lookupOrderAction(values, turnstile.token);
    turnstile.reset();
    if (result.ok) {
      router.push({ pathname: '/order-lookup', query: { code: result.code } });
      router.refresh();
      return;
    }
    // A validation failure here means the same as "not found" for the visitor.
    setNotice(result.error === 'validation' ? 'notFound' : result.error);
  }

  return (
    <Form {...form}>
      <form
        method="post"
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex max-w-md flex-col gap-5"
        noValidate
      >
        {notice && (
          <FormNotice tone="error">
            {notice === 'unexpected'
              ? tErrors('unexpected')
              : notice === 'captchaFailed'
                ? tSecurity('captchaFailed')
                : t(notice)}
          </FormNotice>
        )}
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('code')}</FormLabel>
              <FormControl>
                <Input
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  {...field}
                />
              </FormControl>
              <FormDescription>{t('codeHint')}</FormDescription>
              <AccountFormMessage />
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
                <Input type="tel" autoComplete="tel" inputMode="tel" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <TurnstileWidget {...turnstile.widgetProps} />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('submit')}
        </Button>
      </form>
    </Form>
  );
}
