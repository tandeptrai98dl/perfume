import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/toaster';

import { AdminMobileNav, AdminSidebar } from './admin-nav';
import { AdminSessionProvider, type AdminSessionValue } from './admin-session';
import { visibleNav } from './nav-items';
import { SignOutButton } from './sign-out-button';

/**
 * Admin frame (§8.4): sidebar filtered by the role's permissions, top bar with the user,
 * role and sign out. Optimised for ≥ 1024 px and usable on tablets.
 */
export async function AdminShell({
  session,
  children,
}: {
  session: AdminSessionValue;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const sections = visibleNav(session.permissions);
  return (
    <AdminSessionProvider value={session}>
      <NuqsAdapter>
        <a
          href="#admin-main"
          className="bg-ink-950 text-ivory-50 sr-only z-50 px-4 py-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {t('skipToContent')}
        </a>
        <div className="flex min-h-dvh">
          <AdminSidebar sections={sections} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-line-200 sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-white px-4 lg:px-8">
              <AdminMobileNav sections={sections} />
              <Link href="/admin" className="text-h3 mr-auto">
                {t('title')}
              </Link>
              <p className="text-small hidden text-right sm:block">
                <span className="font-medium">{session.user.name}</span>
                <span className="text-taupe-600"> · {t(`roles.${session.user.role}`)}</span>
              </p>
              <SignOutButton />
            </header>
            <main id="admin-main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none lg:px-8">
              {children}
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" />
      </NuqsAdapter>
    </AdminSessionProvider>
  );
}
