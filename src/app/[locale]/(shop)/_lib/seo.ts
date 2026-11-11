import type { Metadata } from 'next';

import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';

/*
 * SEO helpers for storefront pages (§13.1). They read APP_URL at request time, so call them
 * only from request-time code (generateMetadata with runtime params, or after `connection()`):
 * a value baked in at build time would point to the build machine.
 */

export type PageHref = Parameters<typeof getPathname>[0]['href'];

export function siteUrl(): string {
  return serverEnv().APP_URL.replace(/\/+$/, '');
}

export function absoluteUrl(locale: Locale, href: PageHref, search = ''): string {
  return `${siteUrl()}${getPathname({ locale, href })}${search}`;
}

/**
 * Canonical for the current locale plus hreflang alternates (vi, en, x-default = vi). Pass only
 * the locales where the page exists: an English URL is omitted when the content has no
 * published English translation.
 */
export function alternates(
  current: Locale,
  hrefs: Partial<Record<Locale, PageHref>>,
  search = '',
): NonNullable<Metadata['alternates']> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) {
    const href = hrefs[locale];
    if (href) languages[locale] = absoluteUrl(locale, href, search);
  }
  const fallback = hrefs[routing.defaultLocale];
  if (fallback) languages['x-default'] = absoluteUrl(routing.defaultLocale, fallback, search);
  const own = hrefs[current];
  return { canonical: own ? absoluteUrl(current, own, search) : undefined, languages };
}

export const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: true };

/** Keeps titles within ~60 characters by dropping the suffix first (§13.1). */
export function fitTitle(main: string, suffix: string, max = 60): string {
  const full = `${main} | ${suffix}`;
  return full.length <= max ? full : main;
}

export function truncate(text: string, max = 155): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Slug pages list one placeholder in generateStaticParams: it is not a valid slug, so the
 * build renders a 404 without touching the database, while real slugs render on first
 * request and are then cached (ISR). Awaiting params outside Suspense keeps real 404 statuses.
 */
export const PLACEHOLDER_SLUG = '__placeholder__';

export function placeholderParams() {
  return [{ slug: PLACEHOLDER_SLUG }];
}
