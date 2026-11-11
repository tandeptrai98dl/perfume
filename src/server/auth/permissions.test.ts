import { describe, expect, it } from 'vitest';

import {
  hasPermission,
  isStaffRole,
  PERMISSIONS,
  permissionsFor,
  type Permission,
} from './permissions';

// Mirrors the table in docs/ARCHITECTURE.md §11.1, one row per line: [owner, manager, staff, editor].
const MATRIX: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  'admin.access': [true, true, true, true],
  'dashboard.viewRevenue': [true, true, false, false],
  'orders.view': [true, true, true, false],
  'orders.process': [true, true, true, false],
  'orders.createManual': [true, true, true, false],
  'orders.editBeforeShipping': [true, true, true, false],
  'orders.cancelPaid': [true, true, false, false],
  'payments.refund': [true, true, false, false],
  'payments.confirmBankTransfer': [true, true, false, false],
  'payments.reconcileCod': [true, true, false, false],
  'products.editContent': [true, true, false, true],
  'products.editPrices': [true, true, false, false],
  'translations.edit': [true, true, false, true],
  'inventory.adjust': [true, true, true, false],
  'customers.view': [true, true, false, false],
  'customers.viewContactInOrder': [true, true, true, false],
  'customers.export': [true, false, false, false],
  'coupons.manage': [true, true, false, false],
  'reviews.moderate': [true, true, false, true],
  'content.manage': [true, true, false, true],
  'settings.manage': [true, false, false, false],
  'staff.manage': [true, false, false, false],
  'privacyRequests.handle': [true, false, false, false],
  'auditLog.view': [true, true, false, false],
};

const ROLES = ['owner', 'manager', 'staff', 'editor'] as const;

describe('permission matrix', () => {
  it('covers every permission', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    it(`matches ARCHITECTURE §11.1 for ${permission}`, () => {
      const actual = ROLES.map((role) => hasPermission(role, permission));
      expect(actual).toEqual(MATRIX[permission]);
    });
  }

  it('grants customers nothing', () => {
    expect(permissionsFor('customer')).toEqual([]);
    expect(hasPermission('customer', 'admin.access')).toBe(false);
  });

  it('rejects unknown roles', () => {
    expect(hasPermission('root', 'admin.access')).toBe(false);
    expect(permissionsFor('__proto__')).toEqual([]);
    expect(isStaffRole('customer')).toBe(false);
    expect(isStaffRole('editor')).toBe(true);
  });
});
