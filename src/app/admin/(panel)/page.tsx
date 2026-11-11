import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { isStaffRole } from '@/server/auth/permissions';

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { user } = await requireAdminPage();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const role = user.role ?? 'customer';
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-h2">{t('dashboard.title')}</h1>
      <p>{t('dashboard.welcome', { name: user.name })}</p>
      {isStaffRole(role) && <p>{t('dashboard.role', { role: t(`roles.${role}`) })}</p>}
      <p>{t('dashboard.placeholder')}</p>
    </section>
  );
}
