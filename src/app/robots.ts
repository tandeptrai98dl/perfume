import type { MetadataRoute } from 'next';
import { connection } from 'next/server';

import { routing } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';
import { localizedPath } from '@/lib/seo/paths';

/**
 * robots.txt (§13.1): block admin, API and private or duplicate storefront pages (cart,
 * checkout, account, search, review links) in both locales.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const origin = serverEnv().APP_URL.replace(/\/+$/, '');
  const privateRoutes = ['/cart', '/checkout', '/account', '/search', '/order-lookup'] as const;
  const disallow = [
    '/admin',
    '/api/',
    ...routing.locales.flatMap((locale) => [
      ...privateRoutes.map((route) => localizedPath(locale, route)),
      // Review links carry one-time tokens (`/danh-gia/[token]`).
      `${localizedPath(locale, '/review/[token]', { token: 'x' }).slice(0, -1)}`,
    ]),
  ];
  return {
    rules: [{ userAgent: '*', allow: '/', disallow }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
