import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { CancelOrderButton } from '@/components/account/cancel-order-button';
import { OrderDetail } from '@/components/account/order-detail';
import { Link } from '@/i18n/navigation';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { carrierTrackingUrl } from '@/server/modules/notification';
import { getCustomerOrder } from '@/server/modules/order';

import {
  ACCOUNT_ROBOTS,
  AccountHeader,
  accountLocale,
  AccountSkeleton,
} from '../../_lib/account-page';

type Props = PageProps<'/[locale]/account/orders/[code]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await accountLocale(params);
  const { code } = await params;
  const t = await getTranslations({ locale, namespace: 'account.orders' });
  return {
    title: t('detailTitle', { code: decodeURIComponent(code).toUpperCase() }),
    robots: ACCOUNT_ROBOTS,
  };
}

/**
 * Order detail (§5.1). The query is scoped by the signed-in user's id: another customer's code
 * is a plain 404 (IDOR protection, §12).
 */
export default function OrderPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const { code } = await params;
  const session = await requireCustomerPage(locale, {
    pathname: '/account/orders/[code]',
    params: { code: decodeURIComponent(code) },
  });
  const order = await getCustomerOrder(getDb(), {
    userId: session.user.id,
    code: decodeURIComponent(code),
  });
  if (!order) notFound();
  const t = await getTranslations({ locale, namespace: 'account.orders' });

  return (
    <>
      <Link
        href="/account/orders"
        className="text-small text-gold-700 mb-4 inline-flex min-h-11 items-center hover:underline"
      >
        {t('back')}
      </Link>
      <AccountHeader title={t('detailTitle', { code: order.code })} />
      <OrderDetail
        order={order}
        shipments={order.shipments.map((s) => ({
          ...s,
          trackingUrl: carrierTrackingUrl(s.carrier, s.trackingCode),
        }))}
        actions={order.canCancel ? <CancelOrderButton code={order.code} /> : undefined}
      />
    </>
  );
}
