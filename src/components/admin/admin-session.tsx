'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { Permission, StaffRole } from '@/server/auth/permissions';

/**
 * The signed-in staff member as seen by client components: used to hide or disable controls.
 * Never a security boundary — every Server Action and Route Handler checks again.
 */
export type AdminSessionValue = {
  user: { id: string; name: string; role: StaffRole };
  permissions: readonly Permission[];
};

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({
  value,
  children,
}: {
  value: AdminSessionValue;
  children: ReactNode;
}) {
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession must be used inside <AdminSessionProvider>');
  return value;
}

export function useCan(permission: Permission): boolean {
  return useAdminSession().permissions.includes(permission);
}

/** Renders `children` only with `permission` (or `fallback`, e.g. a read-only view). */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? children : fallback;
}
