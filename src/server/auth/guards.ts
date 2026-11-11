import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { checkAdminSession, type AuthFailure } from './admin-access';
import type { AuthSession } from './config';
import type { Permission } from './permissions';
import { getAuth } from './server';

export class AuthorizationError extends Error {
  constructor(public readonly reason: AuthFailure) {
    super(`Authorization failed: ${reason}`);
    this.name = 'AuthorizationError';
  }
}

/** Current session for this request (deduplicated per render). */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  // Read request headers first: this marks the render dynamic before touching env/DB.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/**
 * For Server Actions and Route Handlers: throws `AuthorizationError` unless the caller is a
 * 2FA-verified staff member with `permission`. Call it right after Zod validation.
 */
export async function requirePermission(permission: Permission): Promise<AuthSession> {
  const current = await getSession();
  const failure = checkAdminSession(current, permission);
  if (failure || !current) throw new AuthorizationError(failure ?? 'unauthenticated');
  return current;
}

/** For admin pages and layouts: redirects instead of throwing. */
export async function requireAdminPage(permission?: Permission): Promise<AuthSession> {
  const current = await getSession();
  const failure = checkAdminSession(current, permission);
  switch (failure) {
    case null:
      return current!;
    case 'twoFactorSetupRequired':
      redirect('/admin/two-factor');
    case 'forbidden':
      redirect('/admin/forbidden');
    default:
      redirect('/admin/login');
  }
}
