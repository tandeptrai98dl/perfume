'use client';

import { CheckCircle2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';

import { Countdown } from './countdown';
import { usePaymentStatus, type LiveStatus } from './use-payment-status';

/**
 * VNPay: a redirect button to the gateway. After returning, the page only displays status
 * (the IPN changes it, §10.4) and polls until VNPay's IPN arrives.
 */
export function VnpayPanel(props: {
  code: string;
  token: string | null;
  initial: Pick<LiveStatus, 'status' | 'paymentStatus' | 'amountPaid'>;
  amount: number;
  checkoutUrl: string;
  expiresAt: string;
  returned: boolean;
}) {
  const t = useTranslations('checkoutResult');
  const format = useFormatter();
  const router = useRouter();
  const [paid, setPaid] = useState(false);
  const onChange = useCallback(
    (next: LiveStatus) => {
      if (next.amountPaid > props.initial.amountPaid) setPaid(true);
      router.refresh();
    },
    [props.initial.amountPaid, router],
  );
  usePaymentStatus({
    code: props.code,
    token: props.token,
    initial: props.initial,
    enabled: !paid,
    onChange,
  });
  const onExpire = useCallback(() => router.refresh(), [router]);

  return (
    <section
      aria-labelledby="vnpay-heading"
      className="border-line-200 flex flex-col gap-4 border bg-white p-6"
      data-testid="vnpay-panel"
    >
      <h2 id="vnpay-heading" className="text-h3">
        {t('vnpay.heading')}
      </h2>
      <p className="text-small text-taupe-600">{t('vnpay.description')}</p>
      {!paid && (
        <Button asChild size="lg" className="w-full sm:w-fit">
          <a href={props.checkoutUrl}>
            {t('vnpay.pay', { amount: format.number(props.amount, 'vnd') })}
          </a>
        </Button>
      )}
      {!paid && <Countdown expiresAt={props.expiresAt} onExpire={onExpire} />}
      <p role="status" className="text-small flex items-center gap-2">
        {paid ? (
          <>
            <CheckCircle2 aria-hidden className="text-success size-4" />
            <span className="text-success font-medium">{t('live.paid')}</span>
          </>
        ) : props.returned ? (
          <>
            <Spinner className="size-4" />
            <span>{t('vnpay.returned')}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}
