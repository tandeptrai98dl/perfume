'use client';

import type { Route } from 'next';
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { subscribeNewsletterAction } from '@/actions/newsletter';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget, useTurnstile } from '@/components/ui/turnstile-widget';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile';
import { cn } from '@/lib/utils';

/**
 * NewsletterSignup (§8.3, footer + home): e-mail and an unticked, specific consent checkbox
 * (PDPL). A confirmation link is e-mailed (double opt-in); the answer is the same for every
 * address, so the form never reveals whether someone is already subscribed.
 */
export function NewsletterSignup({
  source,
  privacyHref,
  className,
  layout = 'stacked',
}: {
  source: 'footer' | 'home';
  /** Published privacy policy of the current locale, linked from the consent text. */
  privacyHref: string | null;
  className?: string;
  layout?: 'stacked' | 'inline';
}) {
  const t = useTranslations('newsletter');
  const locale = useLocale() as 'vi' | 'en';
  const id = useId();
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.newsletter);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className={cn('flex flex-col gap-4', className)} data-testid={`newsletter-${source}`}>
        <FormNotice tone="success">{t('sent')}</FormNotice>
      </div>
    );
  }

  const fieldError = (path: string) => {
    const code = fieldErrors[path];
    if (!code) return null;
    return t.has(`errors.${code}` as 'errors.invalid')
      ? t(`errors.${code}` as 'errors.invalid')
      : t('errors.invalid');
  };
  const emailError = fieldError('email');
  const consentError = fieldError('consent');

  return (
    <form
      noValidate
      data-testid={`newsletter-${source}`}
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        startTransition(async () => {
          const result = await subscribeNewsletterAction(
            { email, consent, locale, source },
            turnstile.token,
          );
          turnstile.reset();
          if (result.ok) {
            setSent(true);
            return;
          }
          if (result.error === 'validation') {
            setFieldErrors(
              Object.fromEntries(result.fieldErrors.map((issue) => [issue.path, issue.code])),
            );
            return;
          }
          setError(t(`errors.${result.error}`));
        });
      }}
    >
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <div
        className={cn(
          'flex flex-col gap-2',
          layout === 'inline' && 'sm:flex-row sm:items-start sm:gap-3',
        )}
      >
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${id}-email`}>{t('email')}</Label>
          <Input
            id={`${id}-email`}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
          />
          {emailError && (
            <p id={`${id}-email-error`} role="alert" className="text-small text-danger">
              {emailError}
            </p>
          )}
        </div>
        <Button
          type="submit"
          loading={pending}
          className={cn('self-start', layout === 'inline' && 'sm:mt-7')}
        >
          {t('submit')}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-consent`}
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
            aria-invalid={!!consentError}
            aria-describedby={consentError ? `${id}-consent-error` : undefined}
            className="mt-3"
          />
          <Label
            htmlFor={`${id}-consent`}
            className="text-small min-h-11 content-center font-normal text-taupe-600"
          >
            {t('consent')}
          </Label>
        </div>
        {consentError && (
          <p id={`${id}-consent-error`} role="alert" className="text-small text-danger">
            {consentError}
          </p>
        )}
        {privacyHref && (
          <p className="text-small text-taupe-600">
            <NextLink
              href={privacyHref as Route}
              className="hover:text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4 md:min-h-9"
            >
              {t('privacyLink')}
            </NextLink>
          </p>
        )}
      </div>
      <TurnstileWidget {...turnstile.widgetProps} />
    </form>
  );
}
