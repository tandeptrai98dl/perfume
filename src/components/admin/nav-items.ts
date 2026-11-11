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
  {
    labelKey: 'content',
    items: [
      { href: '/admin/content/banners', labelKey: 'banners', permission: 'content.manage' },
      { href: '/admin/content/pages', labelKey: 'pages', permission: 'content.manage' },
      { href: '/admin/content/posts', labelKey: 'posts', permission: 'content.manage' },
      { href: '/admin/content/topics', labelKey: 'topics', permission: 'content.manage' },
      { href: '/admin/content/navigation', labelKey: 'navigation', permission: 'content.manage' },
      { href: '/admin/content/redirects', labelKey: 'redirects', permission: 'content.manage' },
    ],
  },
];
