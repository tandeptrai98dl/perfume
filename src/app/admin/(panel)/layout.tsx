import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { SignOutButton } from '@/components/admin/sign-out-button';
import { requireAdminPage } from '@/server/auth/guards';

/**
 * Every page in this group requires a staff session that passed TOTP within the last 8 hours.
 * Pages that need a specific permission call `requireAdminPage(permission)` themselves.
 */
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-line-200 flex items-center justify-between gap-4 border-b p-4">
        <Link href="/admin" className="font-medium">
          {t('title')}
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/admin">{t('nav.dashboard')}</Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
