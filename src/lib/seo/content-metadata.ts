import type { Metadata } from 'next';

import type { Locale } from '@/i18n/routing';

import { absoluteUrl } from './paths';

/**
 * Metadata for bilingual content pages (§13.1): per-locale canonical, hreflang vi/en with
 * x-default = vi (only published locales), Open Graph. URLs are absolute and built from the
 * runtime APP_URL (metadata is rendered at request time for content pages).
 */

export const OG_LOCALES: Record<Locale, string> = { vi: 'vi_VN', en: 'en_US' };

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 155;

/** Cuts at a word boundary and adds an ellipsis when longer than `max`. */
export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  // Keep the last word when it ends exactly at the cut.
  const space = text[max - 1] === ' ' ? cut.length : cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

export type HreflangAlternates = Partial<Record<Locale, string>>;

/** `alternates.languages` with x-default = the Vietnamese URL (ADR-0011). */
export function hreflang(origin: string, alternates: HreflangAlternates) {
  const languages: Record<string, string> = {};
  if (alternates.vi) languages.vi = absoluteUrl(origin, alternates.vi);
  if (alternates.en) languages.en = absoluteUrl(origin, alternates.en);
  if (alternates.vi) languages['x-default'] = absoluteUrl(origin, alternates.vi);
  return languages;
}

export function contentMetadata(args: {
  origin: string;
  locale: Locale;
  title: string;
  description: string;
  path: string;
  alternates: HreflangAlternates;
  type?: 'website' | 'article';
  publishedTime?: Date;
  modifiedTime?: Date;
  image?: string | null;
}): Metadata {
  const url = absoluteUrl(args.origin, args.path);
  const description = truncate(args.description, DESCRIPTION_MAX);
  const title = truncate(args.title, TITLE_MAX);
  const otherLocales = (Object.keys(args.alternates) as Locale[]).filter((l) => l !== args.locale);
  return {
    title,
    description,
    alternates: { canonical: url, languages: hreflang(args.origin, args.alternates) },
    openGraph: {
      type: args.type ?? 'website',
      url,
      title,
      description,
      locale: OG_LOCALES[args.locale],
      alternateLocale: otherLocales.map((l) => OG_LOCALES[l]),
      ...(args.image ? { images: [{ url: args.image }] } : {}),
      ...(args.type === 'article'
        ? {
            publishedTime: args.publishedTime?.toISOString(),
            modifiedTime: args.modifiedTime?.toISOString(),
          }
        : {}),
    },
  };
}
