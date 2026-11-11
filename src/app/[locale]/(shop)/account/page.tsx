import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { OrderHistory } from '@/components/account/order-history';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getProfile, listAddresses } from '@/server/modules/customer';
import { listCustomerOrders } from '@/server/modules/order';

import {
  AccountHeader,
  accountLocale,
  accountMetadata,
  AccountSkeleton,
} from './_lib/account-page';

type Props = PageProps<'/[locale]/account'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return accountMetadata(params, 'metaTitle');
}

/** Account overview (§5.1): recent orders, default address, profile summary. */
export default function AccountPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Overview params={params} />
    </Suspense>
  );
}

async function Overview({ params }: { params: Props['params'] }) {
  const locale: Locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account' });
  const t = await getTranslations({ locale, namespace: 'account' });
  const db = getDb();
  const [profile, orders, addresses] = await Promise.all([
    getProfile(db, session.user.id),
    listCustomerOrders(db, { userId: session.user.id, pageSize: 3 }),
    listAddresses(db, session.user.id),
  ]);
  const address = addresses.find((a) => a.isDefault);

  return (
    <>
      <AccountHeader
        title={t('greeting', { name: profile?.name ?? session.user.name })}
        intro={t('overview.intro')}
      />
      <div className="flex flex-col gap-12">
        <section aria-labelledby="recent-orders" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="recent-orders" className="text-h2">
              {t('overview.recentOrders')}
            </h2>
            {orders.total > 0 && (
              <Link href="/account/orders" className="text-gold-700 hover:underline">
                {t('overview.viewAll')}
              </Link>
            )}
          </div>
          {orders.rows.length > 0 ? (
            <OrderHistory orders={orders.rows} />
          ) : (
            <div className="border-line-200 flex flex-col items-start gap-4 border p-6">
              <p className="text-taupe-600">{t('overview.noOrders')}</p>
              <Button asChild variant="secondary">
                <Link href="/perfumes">{t('overview.shop')}</Link>
              </Button>
            </div>
          )}
        </section>

        <div className="grid gap-8 md:grid-cols-2">
          <section
            aria-labelledby="default-address"
            className="bg-sand-100 flex flex-col gap-3 p-6"
          >
            <h2 id="default-address" className="text-h3">
              {t('overview.defaultAddress')}
            </h2>
            {address ? (
              <address className="text-ink-700 not-italic">
                {address.fullName}
                <br />
                {address.street}
                <br />
                {locale === 'en' ? address.wardNameAscii : address.wardName},{' '}
                {locale === 'en' ? address.provinceNameAscii : address.provinceName}
              </address>
            ) : (
              <p className="text-taupe-600">{t('overview.noAddress')}</p>
            )}
            <Link href="/account/addresses" className="text-gold-700 mt-auto hover:underline">
              {t('overview.manageAddresses')}
            </Link>
          </section>
          <section
            aria-labelledby="profile-summary"
            className="bg-sand-100 flex flex-col gap-3 p-6"
          >
            <h2 id="profile-summary" className="text-h3">
              {t('overview.profile')}
            </h2>
            <p className="break-words">{profile?.email ?? session.user.email}</p>
            <p className="text-taupe-600">
              {t('overview.language', {
                language: t(`profile.languages.${profile?.locale ?? 'vi'}`),
              })}
            </p>
            {profile && !profile.emailVerified && (
              <p className="text-small text-warning">{t('overview.unverified')}</p>
            )}
            <Link href="/account/profile" className="text-gold-700 mt-auto hover:underline">
              {t('overview.editProfile')}
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
