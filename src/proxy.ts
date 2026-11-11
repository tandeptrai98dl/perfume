import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/**
 * Next.js 16 proxy (formerly middleware). Handles locale routing for the storefront.
 * /admin and /api are outside the localized app and are skipped here.
 */
export default createMiddleware(routing);

export const config = {
  matcher: '/((?!api|admin|_next|_vercel|.*\\..*).*)',
};
