import { Suspense } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { ShellSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { isStaffRole, permissionsFor } from '@/server/auth/permissions';

/**
 * Entering the panel (e.g. from /admin/login) always waits for the session check, so it is
 * not validated as an instant navigation; navigations between admin pages still are, and each
 * page streams its data behind its own Suspense boundary.
 */
export const instant = false;

/**
 * Every page in this group requires a staff session that passed TOTP within the last 8 hours.
 * Pages that need a specific permission call `requireAdminPage(permission)` themselves.
 */
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Panel>{children}</Panel>
    </Suspense>
  );
}

async function Panel({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdminPage();
  const role = user.role ?? 'customer';
  // requireAdminPage already redirected non-staff; this narrows the type.
  if (!isStaffRole(role)) return null;
  return (
    <AdminShell
      session={{
        user: { id: user.id, name: user.name, role },
        permissions: permissionsFor(role),
      }}
    >
      {children}
    </AdminShell>
  );
}
