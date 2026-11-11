'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import type { CheckoutFormValues } from '@/lib/checkout/form-schema';

import { CheckoutFieldMessage } from './field-message';

type ConsentName = 'consents.terms' | 'consents.privacy' | 'consents.marketing';

/**
 * Terms + Privacy Policy are required and recorded in `consents`; the marketing opt-in is
 * separate and unticked by default (§10.4, Decree 356/2025).
 */
export function ConsentCheckboxes({
  termsHref,
  privacyHref,
}: {
  termsHref: string | null;
  privacyHref: string | null;
}) {
  const t = useTranslations('checkout.consents');
  const termsLink = (chunks: ReactNode) => <PolicyLink href={termsHref}>{chunks}</PolicyLink>;
  const privacyLink = (chunks: ReactNode) => <PolicyLink href={privacyHref}>{chunks}</PolicyLink>;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{t('legend')}</legend>
      <ConsentField name="consents.terms" required>
        {t.rich('terms', { link: termsLink })}
      </ConsentField>
      <ConsentField name="consents.privacy" required>
        {t.rich('privacy', { link: privacyLink })}
      </ConsentField>
      <ConsentField name="consents.marketing">{t('marketing')}</ConsentField>
    </fieldset>
  );
}

/** Opens in a new tab so the filled-in form is kept. */
function PolicyLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="text-gold-700 underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function ConsentField({
  name,
  required = false,
  children,
}: {
  name: ConsentName;
  required?: boolean;
  children: ReactNode;
}) {
  const form = useFormContext<CheckoutFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="gap-1">
          <div className="flex min-h-11 items-start gap-3 py-1">
            <FormControl>
              <Checkbox
                ref={field.ref}
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                aria-required={required || undefined}
                className="mt-0.5"
              />
            </FormControl>
            <FormLabel className="text-small font-normal">{children}</FormLabel>
          </div>
          <CheckoutFieldMessage />
        </FormItem>
      )}
    />
  );
}
