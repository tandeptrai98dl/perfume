import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ProfileForm } from '@/components/account/profile-form';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getProfile } from '@/server/modules/customer';

import {
  AccountHeader,
  accountLocale,
  accountMetadata,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/profile'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return accountMetadata(params, 'profile.metaTitle');
}

/** Profile (§10.6): details, e-mail language (`users.locale`), marketing opt-in (consents). */
export default function ProfilePage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Profile params={params} />
    </Suspense>
  );
}

async function Profile({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/profile' });
  const t = await getTranslations({ locale, namespace: 'account.profile' });
  const profile = await getProfile(getDb(), session.user.id);
  if (!profile) return null;
  return (
    <>
      <AccountHeader title={t('title')} intro={t('intro')} />
      <ProfileForm
        email={profile.email}
        initial={{
          name: profile.name,
          phone: profile.phone ?? '',
          birthday: profile.birthday ?? '',
          locale: profile.locale,
          marketingOptIn: profile.marketingOptIn,
        }}
      />
    </>
  );
}
