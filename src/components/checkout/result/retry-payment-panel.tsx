'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { startPaymentAction, type StartPaymentResult } from '@/actions/payment';
import { Button } from '@/components/ui/button';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { useRouter } from '@/i18n/navigation';

type Provider = 'vnpay' | 'payos';
type Failure = Extract<StartPaymentResult, { ok: false }>['error'];

/**
 * RetryPaymentPanel (ADR-0006): starts a new payment session while the stock reservation is
 * valid; the customer may switch method. VNPay redirects to the gateway, VietQR re-renders
 * the page with the new code.
 */
export function RetryPaymentPanel({
  code,
  token,
  locale,
  providers,
  defaultProvider,
  variant,
}: {
  code: string;
  token: string | null;
  locale: 'vi' | 'en';
  providers: Provider[];
  defaultProvider: Provider;
  /** `start`: first payment; `retry`: after an expired session; `change`: switch method. */
  variant: 'start' | 'retry' | 'change';
}) {
  const t = useTranslations('checkoutResult.retry');
  const id = useId();
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>(
    providers.includes(defaultProvider) ? defaultProvider : providers[0]!,
  );
  const [error, setError] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await startPaymentAction({ code, token, provider, locale });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.provider === 'vnpay' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-4"
      data-testid="retry-payment-panel"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2
        id={`${id}-heading`}
        className={variant === 'change' ? 'text-body font-medium' : 'text-h3'}
      >
        {variant === 'change' ? t('change') : t('heading')}
      </h2>
      <RadioGroup
        aria-label={t('method')}
        value={provider}
        onValueChange={(value) => setProvider(value as Provider)}
      >
        {providers.map((value) => (
          <RadioCard
            key={value}
            value={value}
            title={t(`providers.${value}.title`)}
            description={t(`providers.${value}.description`)}
          />
        ))}
      </RadioGroup>
      {error && (
        <p role="alert" className="text-small text-danger">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full sm:w-fit">
        {variant === 'start' ? t('start') : variant === 'retry' ? t('submit') : t('change')}
      </Button>
    </form>
  );
}
