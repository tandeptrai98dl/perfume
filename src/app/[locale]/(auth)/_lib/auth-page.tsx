import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { routing, type Locale } from '@/i18n/routing';
import { localizedPath, matchLocalizedPath } from '@/lib/seo/paths';
import { safeInternalPath } from '@/lib/safe-redirect';

export const AUTH_ROBOTS: NonNullable<Metadata['robots']> = { index: false, follow: true };

export async function authLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return locale;
}

export async function authMetadata(
  params: Promise<{ locale: string }>,
  key: 'signIn' | 'signUp' | 'forgot' | 'reset',
): Promise<Metadata> {
  const locale = await authLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t(`${key}.metaTitle`), robots: AUTH_ROBOTS };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const AUTH_PATHNAMES = new Set(['/sign-in', '/sign-up', '/forgot-password', '/reset-password']);

/**
 * `?next=` validated as an internal path (no open redirects); the account overview otherwise.
 * Auth pages themselves are never a destination (no redirect loops).
 */
export async function nextPath(locale: Locale, searchParams: SearchParams): Promise<string> {
  const fallback = localizedPath(locale, '/account');
  const next = safeInternalPath(firstParam((await searchParams).next), fallback);
  const match = matchLocalizedPath(next.split(/[?#]/)[0]!);
  return match && AUTH_PATHNAMES.has(match.pathname) ? fallback : next;
}

export function AuthHeader({ title, intro }: { title: ReactNode; intro?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-h1">{title}</h1>
      {intro && <p className="text-taupe-600">{intro}</p>}
    </header>
  );
}

export function AuthFormSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
