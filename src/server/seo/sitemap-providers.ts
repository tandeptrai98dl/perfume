import 'server-only';

import { getContentSitemapEntries } from '@/data/content';
import { getCatalogSitemapEntities } from '@/server/catalog-cache';
import { catalogSitemapEntries, type CatalogRouteKind } from '@/server/modules/catalog';
import { localizedPath } from '@/lib/seo/paths';
import { urlsFromAlternates, type SitemapUrl } from '@/lib/seo/sitemap';

/**
 * Sitemap index registry (§13.1: split by type, vi/en alternates, real lastModified, published
 * translations only). Each provider becomes `/sitemaps/<id>.xml` and is listed in
 * `/sitemap.xml`. Next-only (reads through the cached data layer).
 *
 * To add catalogue types, append providers built from the catalogue read API, e.g.
 *
 *   { id: 'products', urls: async (origin) => urlsFromAlternates(origin, await getProductSitemapEntries()) }
 *
 * where each entry is `{ alternates: { vi?: path, en?: path }, lastModified }` with only
 * published locales. Keep ids lowercase with hyphens (`scent-families`).
 */

export type SitemapProvider = {
  id: string;
  urls: (origin: string) => Promise<SitemapUrl[]>;
};

const staticPages: SitemapProvider = {
  id: 'static',
  urls: async (origin) => {
    const { posts } = await getContentSitemapEntries();
    const newestPost = posts.reduce<Date | null>(
      (latest, p) => (!latest || p.lastModified > latest ? p.lastModified : latest),
      null,
    );
    return urlsFromAlternates(origin, [
      { alternates: { vi: localizedPath('vi', '/'), en: localizedPath('en', '/') } },
      {
        alternates: { vi: localizedPath('vi', '/journal'), en: localizedPath('en', '/journal') },
        lastModified: newestPost,
      },
    ]);
  },
};

const contentPages: SitemapProvider = {
  id: 'pages',
  urls: async (origin) => urlsFromAlternates(origin, (await getContentSitemapEntries()).pages),
};

const journal: SitemapProvider = {
  id: 'journal',
  urls: async (origin) => {
    const { posts, topics } = await getContentSitemapEntries();
    return urlsFromAlternates(origin, [...posts, ...topics]);
  },
};

function catalogProvider(id: string, kind: CatalogRouteKind): SitemapProvider {
  return {
    id,
    urls: async (origin) =>
      urlsFromAlternates(origin, catalogSitemapEntries(await getCatalogSitemapEntities(), kind)),
  };
}

export const SITEMAP_PROVIDERS: readonly SitemapProvider[] = [
  staticPages,
  catalogProvider('products', 'product'),
  catalogProvider('brands', 'brand'),
  catalogProvider('categories', 'category'),
  catalogProvider('collections', 'collection'),
  catalogProvider('scent-families', 'family'),
  contentPages,
  journal,
];

export function findSitemapProvider(id: string): SitemapProvider | undefined {
  return SITEMAP_PROVIDERS.find((provider) => provider.id === id);
}
