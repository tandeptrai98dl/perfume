import type { AppPathname } from '@/i18n/routing';
import { localizedPath } from '@/lib/seo/paths';

import { isInfoPageKey, type Locale } from './types';

/** Public URLs of content entities (ADR-0011 localized pathnames). */

export function pagePath(key: string, slug: string, locale: Locale): string {
  return isInfoPageKey(key)
    ? localizedPath(locale, `/${key}` as AppPathname)
    : localizedPath(locale, '/policies/[slug]', { slug });
}

export function postPath(slug: string, locale: Locale): string {
  return localizedPath(locale, '/journal/[slug]', { slug });
}

export function topicPath(slug: string, locale: Locale): string {
  return localizedPath(locale, '/journal/topics/[slug]', { slug });
}

export function journalPath(locale: Locale): string {
  return localizedPath(locale, '/journal');
}

export function homePath(locale: Locale): string {
  return localizedPath(locale, '/');
}

/** Route patterns whose URLs exist only when published content exists (proxy 404s). */
export const CONTENT_ROUTES: readonly AppPathname[] = [
  '/about',
  '/authenticity',
  '/contact',
  '/faq',
  '/policies/[slug]',
  '/journal/[slug]',
  '/journal/topics/[slug]',
];
