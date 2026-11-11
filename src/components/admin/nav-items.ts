import type { Permission } from '@/server/auth/permissions';

/**
 * Admin sidebar entries (§5.2). Streams append their sections here; the AdminShell renders
 * only the items the current role has the permission for. `labelKey` is under `admin.nav`.
 */
export type AdminNavItem = {
  href: `/admin${string}`;
  labelKey: string;
  permission: Permission;
};

export type AdminNavSection = { labelKey: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavSection[] = [
  {
    labelKey: 'overview',
    items: [{ href: '/admin', labelKey: 'dashboard', permission: 'admin.access' }],
  },
];
