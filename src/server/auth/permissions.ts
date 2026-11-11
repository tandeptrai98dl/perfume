/**
 * Static RBAC matrix (docs/ARCHITECTURE.md §11.1). Pure data + functions so it can be used by
 * Server Actions, Route Handlers, admin pages and the worker alike.
 *
 * `customer` has no admin permission. Every staff role can open /admin (`admin.access`);
 * everything else is listed explicitly per role.
 */

export const STAFF_ROLES = ['owner', 'manager', 'staff', 'editor'] as const;
export const USER_ROLES = ['customer', ...STAFF_ROLES] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  'admin.access',
  'dashboard.viewRevenue',
  'orders.view',
  'orders.process',
  'orders.createManual',
  'orders.editBeforeShipping',
  'orders.cancelPaid',
  'payments.refund',
  'payments.confirmBankTransfer',
  'payments.reconcileCod',
  'products.editContent',
  'products.editPrices',
  'translations.edit',
  'inventory.adjust',
  'customers.view',
  'customers.viewContactInOrder',
  'customers.export',
  'coupons.manage',
  'reviews.moderate',
  'content.manage',
  'settings.manage',
  'staff.manage',
  'privacyRequests.handle',
  'auditLog.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER: readonly Permission[] = PERMISSIONS;

const MANAGER: readonly Permission[] = [
  'admin.access',
  'dashboard.viewRevenue',
  'orders.view',
  'orders.process',
  'orders.createManual',
  'orders.editBeforeShipping',
  'orders.cancelPaid',
  'payments.refund',
  'payments.confirmBankTransfer',
  'payments.reconcileCod',
  'products.editContent',
  'products.editPrices',
  'translations.edit',
  'inventory.adjust',
  'customers.view',
  'customers.viewContactInOrder',
  'coupons.manage',
  'reviews.moderate',
  'content.manage',
  'auditLog.view',
];

const STAFF: readonly Permission[] = [
  'admin.access',
  'orders.view',
  'orders.process',
  'orders.createManual',
  'orders.editBeforeShipping',
  'inventory.adjust',
  // Contact details only inside an order; no access to /admin/customers.
  'customers.viewContactInOrder',
];

const EDITOR: readonly Permission[] = [
  'admin.access',
  'products.editContent',
  'translations.edit',
  'reviews.moderate',
  'content.manage',
];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  customer: new Set(),
  owner: new Set(OWNER),
  manager: new Set(MANAGER),
  staff: new Set(STAFF),
  editor: new Set(EDITOR),
};

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function hasPermission(role: string, permission: Permission): boolean {
  if (!(USER_ROLES as readonly string[]).includes(role)) return false;
  return ROLE_PERMISSIONS[role as UserRole].has(permission);
}

export function permissionsFor(role: string): Permission[] {
  if (!(USER_ROLES as readonly string[]).includes(role)) return [];
  return PERMISSIONS.filter((permission) => ROLE_PERMISSIONS[role as UserRole].has(permission));
}
