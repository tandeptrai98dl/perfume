import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { routing, type Locale } from '@/i18n/routing';

/** Account pages are private: never indexed (§13.1), robots.txt also blocks them. */
export const ACCOUNT_ROBOTS: NonNullable<Metadata['robots']> = { index: false, follow: false };

export async function accountLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return locale;
}

export async function accountMetadata(
  params: Promise<{ locale: string }>,
  key: 'metaTitle' | 'orders.metaTitle' | 'addresses.metaTitle' | 'profile.metaTitle',
): Promise<Metadata> {
  const locale = await accountLocale(params);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t(key), robots: ACCOUNT_ROBOTS };
}

export function AccountHeader({ title, intro }: { title: ReactNode; intro?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-2">
      <h1 className="text-h1">{title}</h1>
      {intro && <p className="text-taupe-600">{intro}</p>}
    </header>
  );
}

export function AccountSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}
