import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { TwoFactorSetup } from '@/components/admin/two-factor-setup';
import { isStaffRole } from '@/server/auth/permissions';
import { getSession } from '@/server/auth/guards';

/** Mandatory TOTP enrolment for staff who signed in with a password but have no 2FA yet. */
export default async function AdminTwoFactorPage() {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.twoFactor' });
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl">{t('title')}</h1>
      <p>{t('intro')}</p>
      <Suspense>
        <EnrolmentGate />
      </Suspense>
    </main>
  );
}

async function EnrolmentGate() {
  const current = await getSession();
  if (!current || !isStaffRole(current.user.role ?? 'customer')) redirect('/admin/login');
  if (current.user.twoFactorEnabled) redirect('/admin');
  return <TwoFactorSetup />;
}
