import { connection } from 'next/server';

import { serverEnv } from '@/lib/env';
import { absoluteUrl } from '@/lib/seo/paths';
import { buildSitemapIndex } from '@/lib/seo/sitemap';
import { SITEMAP_PROVIDERS } from '@/server/seo/sitemap-providers';

/** Sitemap index: one child sitemap per content type (§5.3, §13.1). Public, read-only. */
export async function GET() {
  // Request time: the origin comes from the runtime APP_URL, not the build environment.
  await connection();
  const origin = serverEnv().APP_URL.replace(/\/+$/, '');
  const xml = buildSitemapIndex(
    SITEMAP_PROVIDERS.map((provider) => ({
      loc: absoluteUrl(origin, `/sitemaps/${provider.id}.xml`),
    })),
  );
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
