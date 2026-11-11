import 'server-only';

import type { AppPathname, Locale } from '@/i18n/routing';
import { redirect } from '@/i18n/navigation';
import { localizedPath } from '@/lib/seo/paths';

import type { AuthSession } from './config';
import { getSession } from './guards';

/**
 * Customer area guards (§5.1 account routes, §12 data access). Any signed-in, non-banned
 * user may use their own account pages; data queries are still scoped by `user_id`.
 */

export type CustomerSession = AuthSession;

/** The session, or null. Deduplicated per request by `getSession`. */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const current = await getSession();
  if (!current || current.user.banned) return null;
  return current;
}

/**
 * For account pages: redirects to the localized sign-in page with `?next=` pointing back to
 * `returnTo` (a localized path of this site, validated again on sign-in).
 */
export async function requireCustomerPage(
  locale: Locale,
  returnTo: { pathname: AppPathname; params?: Record<string, string> },
): Promise<CustomerSession> {
  const current = await getCustomerSession();
  if (current) return current;
  const next = localizedPath(locale, returnTo.pathname, returnTo.params);
  return redirect({ href: { pathname: '/sign-in', query: { next } }, locale });
}
