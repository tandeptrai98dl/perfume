'use client';

import { CheckCircle2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';

import { Countdown } from './countdown';
import { usePaymentStatus, type LiveStatus } from './use-payment-status';

export type QrPanelProps = {
  code: string;
  token: string | null;
  initial: Pick<LiveStatus, 'status' | 'paymentStatus' | 'amountPaid'>;
  amount: number;
  transferNote: string;
  account: { bin: string; accountNumber: string; accountName: string } | null;
  expiresAt: string;
  checkoutUrl: string | null;
  simulated: boolean;
  /** Server-rendered QR code (`<QrCode>`). */
  qr: ReactNode;
};

/**
 * PaymentQRPanel (§8.3, §10.4): VietQR code with amount and transfer note, 15-minute
 * countdown and live status (3-second polling); turns into "Paid" when the webhook arrives.
 */
export function PaymentQrPanel(props: QrPanelProps) {
  const t = useTranslations('checkoutResult');
  const format = useFormatter();
  const router = useRouter();
  const [paid, setPaid] = useState(false);
  const [expired, setExpired] = useState(false);

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
  const onExpire = useCallback(() => {
    setExpired(true);
    router.refresh();
  }, [router]);

  const amount = format.number(props.amount, 'vnd');
  return (
    <section
      aria-labelledby="qr-heading"
      className="border-line-200 flex flex-col gap-6 border bg-white p-6 md:flex-row md:items-start md:gap-10"
      data-testid="payment-qr-panel"
    >
      <div className="relative mx-auto w-full max-w-64 shrink-0 md:mx-0">
        <div className={paid || expired ? 'opacity-20' : undefined}>{props.qr}</div>
        {paid && (
          <CheckCircle2 aria-hidden className="text-success absolute inset-0 m-auto size-16" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <h2 id="qr-heading" className="text-h3">
          {t('qr.heading')}
        </h2>
        <p className="text-small text-taupe-600">{t('qr.instructions')}</p>
        <dl className="text-small grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-taupe-600">{t('qr.amount')}</dt>
          <dd className="font-medium tabular-nums" data-testid="qr-amount">
            {amount}
          </dd>
          <dt className="text-taupe-600">{t('qr.note')}</dt>
          <dd className="font-mono font-medium break-all" data-testid="qr-note">
            {props.transferNote}
          </dd>
          {props.account && (
            <>
              <dt className="text-taupe-600">{t('qr.accountName')}</dt>
              <dd className="break-words">{props.account.accountName}</dd>
              <dt className="text-taupe-600">{t('qr.accountNumber')}</dt>
              <dd className="font-mono">{props.account.accountNumber}</dd>
              <dt className="text-taupe-600">{t('qr.bin')}</dt>
              <dd className="font-mono">{props.account.bin}</dd>
            </>
          )}
        </dl>
        {!paid && <Countdown expiresAt={props.expiresAt} onExpire={onExpire} />}
        <p
          role="status"
          className="text-small flex items-center gap-2"
          data-testid="payment-live-status"
        >
          {paid ? (
            <>
              <CheckCircle2 aria-hidden className="text-success size-4" />
              <span className="text-success font-medium">{t('live.paid')}</span>
            </>
          ) : expired ? null : (
            <>
              <Spinner className="size-4" />
              <span>{t('live.waiting')}</span>
            </>
          )}
        </p>
        {props.checkoutUrl && !paid && (
          <Button asChild variant="link" className="w-fit">
            <a href={props.checkoutUrl} rel="noopener noreferrer">
              {t('qr.openCheckout')}
            </a>
          </Button>
        )}
        {props.simulated && (
          <p className="text-small text-warning" data-testid="payment-sandbox">
            {t('qr.sandbox')}
          </p>
        )}
      </div>
    </section>
  );
}
