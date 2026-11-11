import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { AddressBook } from '@/components/account/address-book';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { listAddresses, listProvinces, MAX_ADDRESSES } from '@/server/modules/customer';

import {
  AccountHeader,
  accountLocale,
  accountMetadata,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/addresses'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return accountMetadata(params, 'addresses.metaTitle');
}

/** Address book (§10.6): max 10, one default, province → ward. */
export default function AddressesPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Addresses params={params} />
    </Suspense>
  );
}

async function Addresses({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/addresses' });
  const t = await getTranslations({ locale, namespace: 'account.addresses' });
  const db = getDb();
  const [addresses, provinces] = await Promise.all([
    listAddresses(db, session.user.id),
    listProvinces(db),
  ]);
  return (
    <>
      <AccountHeader title={t('title')} />
      <AddressBook addresses={addresses} provinces={provinces} max={MAX_ADDRESSES} />
    </>
  );
}
