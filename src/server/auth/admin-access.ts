import { hasPermission, isStaffRole, type Permission } from './permissions';

/** Staff must re-authenticate (password + TOTP) at least every 8 hours (ARCHITECTURE.md §12). */
export const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export type AuthFailure =
  | 'unauthenticated'
  | 'notStaff'
  | 'twoFactorSetupRequired'
  | 'twoFactorRequired'
  | 'expired'
  | 'forbidden';

/** The subset of a Better Auth session that the admin rules look at. */
export type AdminSessionLike = {
  user: { role?: string | null; twoFactorEnabled?: boolean | null };
  session: { createdAt: Date | string; twoFactorVerified?: boolean | null };
};

/**
 * Checks a session against the admin rules. The first failing rule decides where the user
 * is sent, so the order matters.
 */
export function checkAdminSession(
  current: AdminSessionLike | null,
  permission?: Permission,
  now: number = Date.now(),
): AuthFailure | null {
  if (!current) return 'unauthenticated';
  const { user, session } = current;
  const role = user.role ?? 'customer';
  if (!isStaffRole(role)) return 'notStaff';
  if (!user.twoFactorEnabled) return 'twoFactorSetupRequired';
  if (!session.twoFactorVerified) return 'twoFactorRequired';
  if (now - new Date(session.createdAt).getTime() > ADMIN_SESSION_MAX_AGE_MS) return 'expired';
  if (permission && !hasPermission(role, permission)) return 'forbidden';
  return null;
}
