import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { SetLocaleAlternates, type LocaleAlternates } from '@/components/layout/locale-alternates';
import { RichText, hasRichText } from '@/components/shop/rich-text';
import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { getBrand } from '@/server/catalog-cache';
import type { BrandPage as BrandData } from '@/server/modules/catalog';

import {
  ListingResults,
  ListingSkeleton,
  listingSeo,
  readListingParams,
  type ListingHref,
} from '../../_lib/listing-results';
import { ListingHeader } from '../../_lib/page-header';
import { placeholderParams, truncate } from '../../_lib/seo';

function brandHrefs(brand: BrandData): Partial<Record<Locale, ListingHref>> {
  return Object.fromEntries(
    routing.locales
      .filter((locale) => brand.localeSlugs[locale])
      .map((locale) => [
        locale,
        { pathname: '/brands/[slug]', params: { slug: brand.localeSlugs[locale]! } },
      ]),
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/[locale]/brands/[slug]'>): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  const brand = await getBrand(locale, slug);
  if (!brand) return {};
  const t = await getTranslations({ locale, namespace: 'listing' });
  const listing = await readListingParams(searchParams);
  const title = brand.seoTitle ?? t('brandTitle', { brand: brand.name });
  return {
    title: listing.page > 1 ? t('pageTitle', { title, page: listing.page }) : title,
    description: truncate(brand.seoDescription ?? t('brandDescription', { brand: brand.name })),
    ...listingSeo(locale, brandHrefs(brand), listing),
  };
}

export const generateStaticParams = placeholderParams;
/** The page awaits its slug outside Suspense on purpose (see PLACEHOLDER_SLUG). */
export const instant = false;

export default async function BrandPage({
  params,
  searchParams,
}: PageProps<'/[locale]/brands/[slug]'>) {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  const brand = await getBrand(locale, slug);
  if (!brand) notFound();
  const t = await getTranslations({ locale });
  const hrefs = brandHrefs(brand);
  const switcher: LocaleAlternates = Object.fromEntries(
    routing.locales.map((target) => [target, hrefs[target] ?? '/brands']),
  );

  return (
    <div className="container-content flex flex-col gap-10 py-10 lg:py-16">
      <SetLocaleAlternates alternates={switcher} />
      <ListingHeader
        breadcrumbs={[
          { name: t('navigation.home'), href: getPathname({ locale, href: '/' }) },
          { name: t('navigation.brands'), href: getPathname({ locale, href: '/brands' }) },
          { name: brand.name },
        ]}
        eyebrow={t('listing.brandEyebrow')}
        title={brand.name}
        intro={hasRichText(brand.story) ? <RichText doc={brand.story} /> : undefined}
      />
      <Suspense fallback={<ListingSkeleton />}>
        <BrandListing locale={locale} brand={brand} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BrandListing({
  locale,
  brand,
  searchParams,
}: {
  locale: Locale;
  brand: BrandData;
  searchParams: PageProps<'/[locale]/brands/[slug]'>['searchParams'];
}) {
  const params = await readListingParams(searchParams);
  return (
    <ListingResults
      locale={locale}
      scope={{ kind: 'brand', id: brand.id }}
      href={{ pathname: '/brands/[slug]', params: { slug: brand.slug } }}
      params={params}
      hidden={{ brand: true }}
    />
  );
}
