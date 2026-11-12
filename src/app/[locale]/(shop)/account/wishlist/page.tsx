import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { WishlistGrid } from '@/components/account/wishlist-grid';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getProductSummariesByIds } from '@/server/modules/catalog';
import { listWishlistProductIds } from '@/server/modules/customer';

import {
  ACCOUNT_ROBOTS,
  AccountHeader,
  accountLocale,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/wishlist'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await accountLocale(params);
  const t = await getTranslations({ locale, namespace: 'wishlist.page' });
  return { title: t('metaTitle'), robots: ACCOUNT_ROBOTS };
}

/** Account → Wishlist (§5.1 `/tai-khoan/yeu-thich`, `/en/account/wishlist`). */
export default function WishlistPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Wishlist params={params} />
    </Suspense>
  );
}

async function Wishlist({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/wishlist' });
  const t = await getTranslations({ locale, namespace: 'wishlist.page' });
  const db = getDb();
  const ids = await listWishlistProductIds(db, session.user.id);
  // Products no longer sold (or not published in this language) drop out of the summaries.
  const summaries = await getProductSummariesByIds(locale, ids, db);
  const position = new Map(ids.map((id, index) => [id, index]));
  const products = summaries.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return (
    <>
      <AccountHeader title={t('title')} intro={t('intro')} />
      <WishlistGrid products={products} />
    </>
  );
}
