import type { Locale } from '@/i18n/routing';

import { absoluteUrl } from './paths';

/**
 * Sitemap XML builders (sitemaps.org protocol + xhtml:link alternates, §13.1). Pure functions:
 * route handlers in `src/app/sitemap.xml` and `src/app/sitemaps/[file]` render the output.
 */

export const SITEMAP_MAX_URLS = 50_000;

export type SitemapUrl = {
  loc: string;
  lastModified?: Date | string | null;
  /** hreflang → absolute URL; include the URL itself and `x-default`. */
  alternates?: Record<string, string>;
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function lastmod(value: SitemapUrl['lastModified']): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? null : date.toISOString();
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

export function buildUrlSet(urls: SitemapUrl[]): string {
  const body = urls
    .slice(0, SITEMAP_MAX_URLS)
    .map((url) => {
      const parts = [`<loc>${escapeXml(url.loc)}</loc>`];
      for (const [lang, href] of Object.entries(url.alternates ?? {})) {
        parts.push(
          `<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(href)}"/>`,
        );
      }
      const modified = lastmod(url.lastModified);
      if (modified) parts.push(`<lastmod>${modified}</lastmod>`);
      return `<url>${parts.join('')}</url>`;
    })
    .join('\n');
  return `${XML_HEADER}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

export function buildSitemapIndex(sitemaps: { loc: string; lastModified?: Date | null }[]): string {
  const body = sitemaps
    .map((s) => {
      const modified = lastmod(s.lastModified);
      return `<sitemap><loc>${escapeXml(s.loc)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}</sitemap>`;
    })
    .join('\n');
  return `${XML_HEADER}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/**
 * One `<url>` per published locale, each listing every published locale plus x-default (vi).
 * Entities without a published Vietnamese URL get no x-default.
 */
export function urlsFromAlternates(
  origin: string,
  entries: { alternates: Partial<Record<Locale, string>>; lastModified?: Date | string | null }[],
): SitemapUrl[] {
  return entries.flatMap((entry) => {
    const languages: Record<string, string> = {};
    for (const [locale, path] of Object.entries(entry.alternates)) {
      if (path) languages[locale] = absoluteUrl(origin, path);
    }
    if (languages.vi) languages['x-default'] = languages.vi;
    return Object.entries(entry.alternates)
      .filter(([, path]) => path)
      .map(([, path]) => ({
        loc: absoluteUrl(origin, path!),
        lastModified: entry.lastModified,
        alternates: languages,
      }));
  });
}
