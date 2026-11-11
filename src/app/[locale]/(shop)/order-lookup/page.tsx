import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { OrderDetail } from '@/components/account/order-detail';
import { OrderLookupForm } from '@/components/account/order-lookup-form';
import { Link } from '@/i18n/navigation';
import { getDb } from '@/server/db/client';
import { carrierTrackingUrl } from '@/server/modules/notification';
import { getOrderViewByCode, normalizeOrderCode } from '@/server/modules/order';
import { hasOrderAccess } from '@/server/order-access';

import { resolveLocale } from '../_content/shared';
import { AccountSkeleton } from '../account/_lib/account-page';

type Props = PageProps<'/[locale]/order-lookup'>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'orderLookup' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Guest order lookup (§5.1, §10.5): order code + phone, or an e-mail link with `?t=`. The
 * status view is read-only and shown only with a valid access cookie or token.
 */
export default async function OrderLookupPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'orderLookup' });
  return (
    <div className="container-content py-10 lg:py-16">
      <Suspense fallback={<AccountSkeleton />}>
        <LookupContent searchParams={searchParams} title={t('title')} intro={t('intro')} />
      </Suspense>
    </div>
  );
}

async function LookupContent({
  searchParams,
  title,
  intro,
}: {
  searchParams: Props['searchParams'];
  title: string;
  intro: string;
}) {
  const query = await searchParams;
  const code = normalizeOrderCode(first(query.code) ?? '');
  const token = first(query.t);
  const t = await getTranslations('orderLookup');
  const order =
    code && (await hasOrderAccess(code, token)) ? await getOrderViewByCode(getDb(), code) : null;

  if (!order) {
    return (
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-h1">{title}</h1>
          <p className="text-taupe-600">{intro}</p>
        </header>
        <OrderLookupForm defaultCode={code} />
        <p className="text-small">
          {t('signInHint')}{' '}
          <Link href="/account/orders" className="text-gold-700 hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{t('resultTitle', { code: order.code })}</h1>
      </header>
      <OrderDetail
        order={order}
        shipments={order.shipments.map((s) => ({
          ...s,
          trackingUrl: carrierTrackingUrl(s.carrier, s.trackingCode),
        }))}
      />
      <Link href="/order-lookup" className="text-gold-700 self-start hover:underline">
        {t('another')}
      </Link>
    </div>
  );
}
