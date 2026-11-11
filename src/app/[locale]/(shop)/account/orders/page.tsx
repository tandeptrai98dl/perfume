import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { OrderHistory } from '@/components/account/order-history';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { listCustomerOrders } from '@/server/modules/order';

import { pageParam } from '../../_content/shared';
import {
  AccountHeader,
  accountLocale,
  accountMetadata,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/orders'>;

const PAGE_SIZE = 10;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return accountMetadata(params, 'orders.metaTitle');
}

/** Order history (§5.1), newest first, 10 per page. */
export default function OrdersPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Orders params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/orders' });
  const t = await getTranslations({ locale, namespace: 'account.orders' });
  const tUi = await getTranslations({ locale, namespace: 'ui.pagination' });
  const page = pageParam((await searchParams).page);
  const result = await listCustomerOrders(getDb(), {
    userId: session.user.id,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <>
      <AccountHeader title={t('title')} />
      {result.rows.length === 0 ? (
        <div className="border-line-200 flex flex-col items-start gap-4 border p-6">
          <p className="text-taupe-600">{t('empty')}</p>
          <Button asChild variant="secondary">
            <Link href="/perfumes">
              {(await getTranslations({ locale, namespace: 'account.overview' }))('shop')}
            </Link>
          </Button>
        </div>
      ) : (
        <OrderHistory orders={result.rows} />
      )}
      {pages > 1 && (
        <nav aria-label={tUi('label')} className="mt-8 flex items-center justify-between gap-4">
          {page > 1 ? (
            <Link
              href={{ pathname: '/account/orders', query: { page: String(page - 1) } }}
              className="text-gold-700 inline-flex min-h-11 items-center hover:underline"
            >
              {tUi('previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-small text-taupe-600">{tUi('page', { page })}</span>
          {page < pages ? (
            <Link
              href={{ pathname: '/account/orders', query: { page: String(page + 1) } }}
              className="text-gold-700 inline-flex min-h-11 items-center hover:underline"
            >
              {tUi('next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
