import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';

import { routing, type Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';

/** Locale from route params (the [locale] layout already rejects unknown values). */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return locale;
}

/** Public origin read at request time (never baked in at build time). */
export function siteOrigin(): string {
  return serverEnv().APP_URL.replace(/\/+$/, '');
}

/** Parses `?page=` (1-based); invalid values fall back to 1. */
export function pageParam(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
