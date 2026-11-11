import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';

/**
 * Print-friendly admin pages (packing and delivery slips): same staff + 2FA check as the panel,
 * but no AdminShell, so the browser prints only the documents.
 */
export const instant = false;

export default function AdminPrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard>{children}</Guard>
    </Suspense>
  );
}

async function Guard({ children }: { children: React.ReactNode }) {
  await requireAdminPage('orders.view');
  return children;
}
