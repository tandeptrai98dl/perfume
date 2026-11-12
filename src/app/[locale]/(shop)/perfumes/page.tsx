import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { resolveLocale } from '@/app/[locale]/(shop)/_content/shared';

import { ListingHeader } from '../_lib/page-header';
import {
  ListingResults,
  ListingSkeleton,
  listingSeo,
  readListingParams,
} from '../_lib/listing-results';
import { truncate } from '../_lib/seo';

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/[locale]/perfumes'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'listing' });
  const listing = await readListingParams(searchParams);
  const title =
    listing.page > 1
      ? t('pageTitle', { title: t('perfumesTitle'), page: listing.page })
      : t('perfumesTitle');
  return {
    title,
    description: truncate(t('perfumesDescription')),
    ...listingSeo(locale, { vi: '/perfumes', en: '/perfumes' }, listing),
  };
}

export default async function PerfumesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/perfumes'>) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'listing' });
  return (
    <div className="container-content flex flex-col gap-10 py-10 lg:py-16">
      <Suspense fallback={<HeaderFallback title={t('perfumesTitle')} />}>
        <PerfumesHeader locale={locale} />
      </Suspense>
      <Suspense fallback={<ListingSkeleton />}>
        <PerfumesListing locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PerfumesHeader({ locale }: { locale: Locale }) {
  await connection();
  const t = await getTranslations({ locale });
  return (
    <ListingHeader
      breadcrumbs={[
        { name: t('navigation.home'), href: getPathname({ locale, href: '/' }) },
        { name: t('navigation.perfumes') },
      ]}
      title={t('listing.perfumesTitle')}
      intro={<p>{t('listing.perfumesIntro')}</p>}
    />
  );
}

function HeaderFallback({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-40" />
      <h1 className="text-h1">{title}</h1>
    </div>
  );
}

async function PerfumesListing({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: PageProps<'/[locale]/perfumes'>['searchParams'];
}) {
  const params = await readListingParams(searchParams);
  return (
    <ListingResults locale={locale} scope={{ kind: 'all' }} href="/perfumes" params={params} />
  );
}
