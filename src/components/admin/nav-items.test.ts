import { describe, expect, it } from 'vitest';

import { activeHref, ADMIN_NAV, visibleNav } from './nav-items';

describe('visibleNav', () => {
  it('shows each role only what it may open', () => {
    const editor = visibleNav([
      'admin.access',
      'products.editContent',
      'translations.edit',
    ]).flatMap((s) => s.items.map((i) => i.href));
    expect(editor).toContain('/admin/products');
    expect(editor).not.toContain('/admin/inventory');

    const staff = visibleNav(['admin.access', 'orders.view', 'inventory.adjust']).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(staff).toContain('/admin/inventory');
    expect(staff).not.toContain('/admin/products');
  });

  it('drops empty sections', () => {
    expect(visibleNav(['admin.access']).map((s) => s.labelKey)).toEqual(['overview']);
  });
});

describe('activeHref', () => {
  it('picks the longest matching item', () => {
    expect(activeHref('/admin', ADMIN_NAV)).toBe('/admin');
    expect(activeHref('/admin/inventory/movements', ADMIN_NAV)).toBe('/admin/inventory/movements');
    expect(activeHref('/admin/inventory', ADMIN_NAV)).toBe('/admin/inventory');
    expect(activeHref('/admin/products/123', ADMIN_NAV)).toBe('/admin/products');
    expect(activeHref('/admin/unknown', ADMIN_NAV)).toBeNull();
  });
});
