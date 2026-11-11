import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/** Admin pages reachable without a session. */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login']);

/**
 * Next.js 16 proxy (formerly middleware).
 * - Storefront: locale routing (next-intl).
 * - /admin: optimistic cookie check only, so anonymous visitors get a fast redirect. The real
 *   check (role, 2FA-verified session, permission) runs in the admin layout and in every
 *   Server Action / Route Handler via `requirePermission`.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!PUBLIC_ADMIN_PATHS.has(pathname) && !getSessionCookie(request)) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
