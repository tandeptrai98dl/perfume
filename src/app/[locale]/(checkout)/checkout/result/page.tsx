import { isIP } from 'node:net';

import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PaymentQrPanel } from '@/components/checkout/result/payment-qr-panel';
import { QrCode } from '@/components/checkout/result/qr-code';
import { ResultSummary } from '@/components/checkout/result/result-summary';
import { RetryPaymentPanel } from '@/components/checkout/result/retry-payment-panel';
import { resultView, type ResultState } from '@/components/checkout/result/state';
import { VnpayPanel } from '@/components/checkout/result/vnpay-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getDb } from '@/server/db/client';
import { getPaymentGateways } from '@/server/integrations/payments';
import { errorFields, logger } from '@/server/lib/logger';
import {
  createPaymentSession,
  findOrderByCode,
  getCheckoutResult,
  type CheckoutResult,
  type OnlineProvider,
} from '@/server/modules/payment';
import {
  canViewOrder,
  checkoutResultUrl,
  firstValue,
  paymentDeps,
  pickOrderCode,
} from '@/server/payment-access';

/*
 * Checkout result (§5.1 `/thanh-toan/ket-qua`, §10.4): order summary and status, the VietQR
 * panel or VNPay button, retry after an expired session, clear cancelled/expired states.
 * The page only displays state — gateway return parameters (`vnp_*`, payOS `status`) are
 * ignored apart from a "waiting for confirmation" hint; only IPNs/webhooks change state.
 * Access: the browser that placed the order (cookie), a signed link (`t`), or the owner.
 */

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/checkout/result'>): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'checkoutResult' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function CheckoutResultPage(props: PageProps<'/[locale]/checkout/result'>) {
  const locale = (await props.params).locale as Locale;
  return (
    <div className="container-content flex flex-col gap-8 py-10 lg:py-16">
      <Suspense fallback={<ResultSkeleton />}>
        <ResultContent locale={locale} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const ONLINE_ORDER: OnlineProvider[] = ['payos', 'vnpay'];

async function clientIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? list.get('x-real-ip');
  return forwarded && isIP(forwarded) ? forwarded : null;
}

/**
 * Session creations in flight in this process, per order. Next.js can render this page twice
 * for one request (e.g. the place-order redirect); both renders must share one session instead
 * of the second cancelling the first while its gateway call is still running.
 */
const firstSessions = new Map<string, Promise<boolean>>();

/** The first visit after placing an online order opens its first payment session. */
async function ensureFirstSession(
  result: CheckoutResult,
  providers: OnlineProvider[],
  locale: Locale,
  now: Date,
): Promise<boolean> {
  const view = resultView(result, now);
  if (view.panel !== 'start' || providers.length === 0) return false;
  const pending = firstSessions.get(result.orderId);
  if (pending) return pending;
  const created = openFirstSession(result, providers, locale).finally(() =>
    firstSessions.delete(result.orderId),
  );
  firstSessions.set(result.orderId, created);
  return created;
}

async function openFirstSession(
  result: CheckoutResult,
  providers: OnlineProvider[],
  locale: Locale,
): Promise<boolean> {
  const preferred = providers.find((p) => p === result.paymentMethod) ?? providers[0]!;
  try {
    await createPaymentSession(await paymentDeps(), {
      orderId: result.orderId,
      provider: preferred,
      ipAddress: await clientIp(),
      returnUrl: checkoutResultUrl(locale, result.code),
    });
    return true;
  } catch (error) {
    logger.warn('checkout.result.first_session_failed', {
      provider: preferred,
      ...errorFields(error),
    });
    return false;
  }
}

const ICONS: Record<ResultState, typeof CheckCircle2> = {
  paid: CheckCircle2,
  depositPaid: CheckCircle2,
  codConfirm: CheckCircle2,
  codDepositReceived: CheckCircle2,
  awaitingPayment: Clock,
  depositRequired: Clock,
  sessionExpired: AlertCircle,
  windowClosed: XCircle,
  cancelled: XCircle,
  other: Clock,
};

async function ResultContent({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: PageProps<'/[locale]/checkout/result'>['searchParams'];
}) {
  const t = await getTranslations({ locale, namespace: 'checkoutResult' });
  const format = await getFormatter({ locale });
  const query = await searchParams;
  const code = pickOrderCode(query.code);
  const token = firstValue(query.t);
  const db = getDb();

  const order = code ? await findOrderByCode(db, code) : null;
  if (!code || !order || !(await canViewOrder(order, token))) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <XCircle aria-hidden className="text-gold-500 size-8" />
        <h1 className="text-h1">{t('notFound.title')}</h1>
        <p className="max-w-md text-taupe-600">{t('notFound.description')}</p>
        <Button asChild>
          <Link href="/perfumes">{t('continueShopping')}</Link>
        </Button>
      </div>
    );
  }

  const gateways = getPaymentGateways();
  const providers = ONLINE_ORDER.filter((provider) => gateways[provider]);
  const now = new Date();
  let result = (await getCheckoutResult(db, code, now))!;
  if (await ensureFirstSession(result, providers, locale, now)) {
    result = (await getCheckoutResult(db, code, now))!;
  }
  const { state, panel } = resultView(result, now);
  const Icon = ICONS[state];
  const vnd = (amount: number) => format.number(amount, 'vnd');
  const time = result.reservedUntil
    ? format.dateTime(result.reservedUntil, { hour: '2-digit', minute: '2-digit' })
    : '';
  const description = (() => {
    switch (state) {
      case 'paid':
        return t('state.paid.description', { amount: vnd(result.amountPaid) });
      case 'depositPaid':
        return t('state.depositPaid.description', {
          amount: vnd(result.amountPaid),
          balance: vnd(Math.max(0, result.amountDue)),
        });
      case 'codDepositReceived':
        return t('state.codDepositReceived.description', { amount: vnd(result.amountPaid) });
      case 'awaitingPayment':
      case 'depositRequired':
        return t(`state.${state}.description`, { amount: vnd(result.onlineDue), time });
      case 'sessionExpired':
        return t('state.sessionExpired.description', { time });
      case 'other':
        return t('state.other.description', {
          status: t(`orderStatus.${result.status as 'pending'}`),
        });
      default:
        return t(`state.${state}.description`);
    }
  })();
  const initial = {
    status: result.status,
    paymentStatus: result.paymentStatus,
    amountPaid: result.amountPaid,
  };
  const session = result.session;
  const returnedFromGateway = typeof query.vnp_ResponseCode === 'string';
  const success = ['paid', 'depositPaid', 'codConfirm', 'codDepositReceived'].includes(state);

  return (
    <>
      <header className="flex flex-col gap-3" data-state={state} data-testid="checkout-result">
        <Icon
          aria-hidden
          className={
            success
              ? 'text-success size-10'
              : state === 'cancelled' || state === 'windowClosed'
                ? 'text-danger size-10'
                : 'text-gold-700 size-10'
          }
        />
        <h1 className="text-h1">{t(`state.${state}.title`)}</h1>
        <p className="text-body-lg max-w-2xl text-taupe-600">{description}</p>
        {state === 'cancelled' && result.amountPaid > 0 && (
          <p className="max-w-2xl">
            {t('state.cancelled.refund', { amount: vnd(result.amountPaid) })}
          </p>
        )}
        <p className="text-small">
          <span className="text-taupe-600">{t('orderCode')}: </span>
          <span className="font-mono font-medium" data-testid="order-code">
            {result.code}
          </span>
          <span className="text-taupe-600">
            {' · '}
            {t('placedAt', {
              date: format.dateTime(result.placedAt, { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </span>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-6">
          {panel === 'qr' && session?.qrCode && session.expiresAt && (
            <PaymentQrPanel
              code={result.code}
              token={token}
              initial={initial}
              amount={session.amount}
              transferNote={session.transferNote}
              account={session.account}
              expiresAt={session.expiresAt.toISOString()}
              checkoutUrl={session.checkoutUrl}
              simulated={session.simulated}
              qr={
                <QrCode
                  value={session.qrCode}
                  label={t('qr.alt', { amount: vnd(session.amount) })}
                  className="w-full"
                />
              }
            />
          )}
          {panel === 'vnpay' && session?.checkoutUrl && session.expiresAt && (
            <VnpayPanel
              code={result.code}
              token={token}
              initial={initial}
              amount={session.amount}
              checkoutUrl={session.checkoutUrl}
              expiresAt={session.expiresAt.toISOString()}
              returned={returnedFromGateway}
            />
          )}
          {(panel === 'qr' || panel === 'vnpay') && providers.length > 1 && (
            <div className="border-line-200 border bg-white p-6">
              <RetryPaymentPanel
                code={result.code}
                token={token}
                locale={locale}
                providers={providers}
                defaultProvider={session?.provider === 'payos' ? 'vnpay' : 'payos'}
                variant="change"
              />
            </div>
          )}
          {(panel === 'start' || panel === 'retry') && providers.length > 0 && (
            <div className="border-line-200 border bg-white p-6">
              <RetryPaymentPanel
                code={result.code}
                token={token}
                locale={locale}
                providers={providers}
                defaultProvider={
                  session?.provider ?? (result.paymentMethod === 'vnpay' ? 'vnpay' : 'payos')
                }
                variant={panel}
              />
            </div>
          )}
          {!panel && (
            <Button asChild variant="secondary" className="w-fit">
              <Link href="/perfumes">{t('continueShopping')}</Link>
            </Button>
          )}
        </div>
        <ResultSummary result={result} />
      </div>
    </>
  );
}
