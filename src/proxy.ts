import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { matchLocalizedPath } from './lib/seo/paths';
import { errorFields, logger } from './server/lib/logger';
import { CATALOG_ROUTES } from './server/modules/catalog';
import { CONTENT_ROUTES, decideRoute, normalizePath } from './server/modules/content';
import { countRedirectHit, getRouteTable } from './server/routing/route-table';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/** Catalogue detail routes whose slugs are checked against the route table (real 404s). */
const ROUTED_CATALOG_PATHS = new Set<string>(Object.values(CATALOG_ROUTES));

/** Admin pages reachable without a session. */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login']);

/**
 * Next.js 16 proxy (formerly middleware).
 * - Storefront: `redirects` table and content/catalogue existence (cached route table, no DB
 *   query per request), then locale routing (next-intl).
 * - /admin: optimistic cookie check only, so anonymous visitors get a fast redirect. The real
 *   check (role, 2FA-verified session, permission) runs in the admin layout and in every
 *   Server Action / Route Handler via `requirePermission`.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!PUBLIC_ADMIN_PATHS.has(pathname) && !getSessionCookie(request)) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  const routed = await routeFromTable(request);
  return routed ?? handleI18nRouting(request);
}

/**
 * Redirects from the `redirects` table, and a real 404 status for content URLs that have no
 * published content (with Cache Components the page itself streams with a 200 already sent).
 */
async function routeFromTable(request: NextRequest): Promise<NextResponse | null> {
  const path = normalizePath(request.nextUrl.pathname);
  if (!path) return null;
  try {
    const table = await getRouteTable();
    if (!table) return null;
    const match = matchLocalizedPath(path);
    const isContentRoute =
      !!match &&
      (CONTENT_ROUTES.includes(match.pathname) || ROUTED_CATALOG_PATHS.has(match.pathname));
    const decision = decideRoute(table, path, isContentRoute);

    if (decision.kind === 'redirect') {
      const target = new URL(decision.location, request.url);
      if (target.origin === request.nextUrl.origin && !target.search) {
        target.search = request.nextUrl.search;
      }
      countRedirectHit(path);
      return NextResponse.redirect(target, decision.status);
    }
    if (decision.kind === 'notFound' && match) {
      // Any unknown path under [locale] renders the localized not-found page with status 404.
      return NextResponse.rewrite(new URL(`/${match.locale}/__not-found`, request.url));
    }
  } catch (error) {
    logger.warn('proxy.routeTable.failed', errorFields(error));
  }
  return null;
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
