import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { clientEnv, serverEnv } from './lib/env';
import {
  buildContentSecurityPolicy,
  cspHeaderName,
  reportingEndpoints,
  type CspOptions,
} from './lib/security/csp';
import { matchLocalizedPath } from './lib/seo/paths';
import { errorFields, logger } from './server/lib/logger';
import { CATALOG_ROUTES } from './server/modules/catalog';
import { CONTENT_ROUTES, decideRoute, normalizePath } from './server/modules/content';
import { countRedirectHit, getRouteTable } from './server/routing/route-table';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/** Catalogue detail routes whose slugs are checked against the route table (real 404s). */
const ROUTED_CATALOG_PATHS = new Set<string>(Object.values(CATALOG_ROUTES));

/** Admin pages reachable without a session (set-password: staff invitation link, M3). */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/set-password']);

/**
 * Next.js 16 proxy (formerly middleware).
 * - Every page: the Content Security Policy (§12, ADR-0024), built from runtime env so
 *   report-only mode and report endpoints switch without a rebuild (src/lib/security/csp.ts).
 * - Storefront: `redirects` table and content/catalogue existence (cached route table, no DB
 *   query per request), then locale routing (next-intl).
 * - /admin: optimistic cookie check only, so anonymous visitors get a fast redirect. The real
 *   check (role, 2FA-verified session, permission) runs in the admin layout and in every
 *   Server Action / Route Handler via `requirePermission`.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const csp = contentSecurityPolicy();

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!PUBLIC_ADMIN_PATHS.has(pathname) && !getSessionCookie(request)) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return withCsp(response, csp);
  }

  const routed = await routeFromTable(request);
  return withCsp(routed ?? handleI18nRouting(request), csp);
}

type Csp = { value: string; options: CspOptions; reportOnly: boolean };

let cachedCsp: Csp | undefined;

/** Same for every request (no nonce), so it is built once per process. */
function contentSecurityPolicy(): Csp {
  if (cachedCsp) return cachedCsp;
  const env = serverEnv();
  const options: CspOptions = {
    isDev: env.NODE_ENV === 'development',
    appUrl: env.APP_URL,
    mediaBaseUrl: clientEnv.NEXT_PUBLIC_MEDIA_BASE_URL,
    sentryDsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    vnpayPaymentUrl: env.VNPAY_PAYMENT_URL,
    reportUri: env.CSP_REPORT_URI,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  };
  cachedCsp = {
    value: buildContentSecurityPolicy(options),
    options,
    reportOnly: env.CSP_REPORT_ONLY,
  };
  return cachedCsp;
}

function withCsp(response: NextResponse, csp: Csp): NextResponse {
  response.headers.set(cspHeaderName(csp.reportOnly), csp.value);
  const endpoints = reportingEndpoints(csp.options);
  if (endpoints) response.headers.set('Reporting-Endpoints', endpoints);
  return response;
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
