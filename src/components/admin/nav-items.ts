import type { Permission } from '@/server/auth/permissions';

import type messages from '../../../messages/vi.json';

/** Keys under `admin.nav` in messages/vi.json (typed so a missing label fails typecheck). */
export type AdminNavLabelKey = keyof (typeof messages)['admin']['nav'];

/**
 * Admin sidebar entries (§5.2). Streams append their sections here; the AdminShell renders
 * only the items the current role has the permission for. `labelKey` is under `admin.nav`.
 */
export type AdminNavItem = {
  href: `/admin${string}`;
  labelKey: AdminNavLabelKey;
  permission: Permission;
};

export type AdminNavSection = { labelKey: AdminNavLabelKey; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavSection[] = [
  {
    labelKey: 'overview',
    items: [{ href: '/admin', labelKey: 'dashboard', permission: 'admin.access' }],
  },
  // Stream B: catalogue, inventory.
  {
    labelKey: 'catalog',
    items: [
      { href: '/admin/products', labelKey: 'products', permission: 'products.editContent' },
      { href: '/admin/catalog/brands', labelKey: 'brands', permission: 'products.editContent' },
      {
        href: '/admin/catalog/product-lines',
        labelKey: 'productLines',
        permission: 'products.editContent',
      },
      {
        href: '/admin/catalog/categories',
        labelKey: 'categories',
        permission: 'products.editContent',
      },
      {
        href: '/admin/catalog/collections',
        labelKey: 'collections',
        permission: 'products.editContent',
      },
      { href: '/admin/catalog/families', labelKey: 'families', permission: 'products.editContent' },
      { href: '/admin/catalog/notes', labelKey: 'notes', permission: 'products.editContent' },
    ],
  },
  {
    labelKey: 'inventory',
    items: [
      { href: '/admin/inventory', labelKey: 'stock', permission: 'inventory.adjust' },
      { href: '/admin/inventory/movements', labelKey: 'movements', permission: 'inventory.adjust' },
    ],
  },
];

/** Sections and items visible to a role; empty sections are dropped. */
export function visibleNav(
  permissions: readonly Permission[],
  nav: AdminNavSection[] = ADMIN_NAV,
): AdminNavSection[] {
  return nav
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => permissions.includes(item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Longest matching prefix wins, so /admin only matches the dashboard itself. */
export function activeHref(pathname: string, nav: AdminNavSection[]): string | null {
  let best: string | null = null;
  for (const item of nav.flatMap((section) => section.items)) {
    const matches =
      pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));
    if (matches && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}
