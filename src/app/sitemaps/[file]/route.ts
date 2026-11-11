import { connection } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { buildUrlSet } from '@/lib/seo/sitemap';
import { findSitemapProvider } from '@/server/seo/sitemap-providers';

const fileSchema = z.string().regex(/^[a-z][a-z0-9-]{0,40}\.xml$/);

/**
 * `/sitemaps/<type>.xml` (§13.1). Public and read-only, so there is no permission check; the
 * file name is validated against the provider registry.
 */
export async function GET(_request: Request, { params }: RouteContext<'/sitemaps/[file]'>) {
  const parsed = fileSchema.safeParse((await params).file);
  const provider = parsed.success ? findSitemapProvider(parsed.data.slice(0, -4)) : undefined;
  if (!provider) return new Response('Not found', { status: 404 });

  await connection();
  const origin = serverEnv().APP_URL.replace(/\/+$/, '');
  const xml = buildUrlSet(await provider.urls(origin));
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
