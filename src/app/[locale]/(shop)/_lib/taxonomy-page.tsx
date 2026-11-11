import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { SetLocaleAlternates, type LocaleAlternates } from '@/components/layout/locale-alternates';
import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { getCategory, getCollection, getFamily } from '@/server/catalog-cache';
import type { TaxonomyPage } from '@/server/modules/catalog';

import {
  ListingResults,
  ListingSkeleton,
  listingSeo,
  readListingParams,
  type ListingHref,
} from './listing-results';
import { ListingHeader } from './page-header';
import { truncate } from './seo';

/*
 * Category, collection and scent-family landing pages share one layout: header with intro
 * (SEO landing copy, §13.2) and a filtered listing scoped to the entity.
 */

export type TaxonomyKind = TaxonomyPage['kind'];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const LOADERS = { category: getCategory, collection: getCollection, family: getFamily } as const;

function hrefFor(kind: TaxonomyKind, slug: string): ListingHref {
  if (kind === 'category') return { pathname: '/categories/[slug]', params: { slug } };
  if (kind === 'collection') return { pathname: '/collections/[slug]', params: { slug } };
  return { pathname: '/scent-families/[slug]', params: { slug } };
}

export function loadTaxonomy(kind: TaxonomyKind, locale: Locale, slug: string) {
  return LOADERS[kind](locale, slug);
}

function localeHrefs(entity: TaxonomyPage): Partial<Record<Locale, ListingHref>> {
  return Object.fromEntries(
    routing.locales
      .filter((locale) => entity.localeSlugs[locale])
      .map((locale) => [locale, hrefFor(entity.kind, entity.localeSlugs[locale]!)]),
  );
}

export async function taxonomyMetadata(
  kind: TaxonomyKind,
  locale: Locale,
  slug: string,
  searchParams: SearchParams,
): Promise<Metadata> {
  const entity = await loadTaxonomy(kind, locale, slug);
  if (!entity) return {};
  const t = await getTranslations({ locale, namespace: 'listing' });
  const params = await readListingParams(searchParams);
  const baseTitle =
    entity.seoTitle ?? (kind === 'family' ? t('familyTitle', { name: entity.name }) : entity.name);
  const fallbackDescription =
    kind === 'category'
      ? t('categoryDescription', { name: entity.name })
      : kind === 'collection'
        ? t('collectionDescription', { name: entity.name })
        : t('familyDescription', { name: entity.name });
  return {
    title: params.page > 1 ? t('pageTitle', { title: baseTitle, page: params.page }) : baseTitle,
    description: truncate(entity.seoDescription ?? entity.description ?? fallbackDescription),
    ...listingSeo(locale, localeHrefs(entity), params),
  };
}

export async function TaxonomyListingPage({
  kind,
  params,
  searchParams,
}: {
  kind: TaxonomyKind;
  params: Promise<{ locale: string; slug: string }>;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  const entity = await loadTaxonomy(kind, locale, slug);
  if (!entity) notFound();
  const t = await getTranslations({ locale });
  const hrefs = localeHrefs(entity);
  const switcher: LocaleAlternates = Object.fromEntries(
    routing.locales.map((target) => [target, hrefs[target] ?? '/perfumes']),
  );
  const eyebrow = {
    category: t('listing.categoryEyebrow'),
    collection: t('listing.collectionEyebrow'),
    family: t('listing.familyEyebrow'),
  }[kind];
  const title = kind === 'family' ? t('listing.familyTitle', { name: entity.name }) : entity.name;

  return (
    <div className="container-content flex flex-col gap-10 py-10 lg:py-16">
      <SetLocaleAlternates alternates={switcher} />
      <ListingHeader
        breadcrumbs={[
          { name: t('navigation.home'), href: getPathname({ locale, href: '/' }) },
          { name: t('navigation.perfumes'), href: getPathname({ locale, href: '/perfumes' }) },
          { name: entity.name },
        ]}
        eyebrow={eyebrow}
        title={title}
        intro={
          entity.description ? (
            <p className="whitespace-pre-line">{entity.description}</p>
          ) : undefined
        }
      />
      <Suspense fallback={<ListingSkeleton />}>
        <ScopedListing
          locale={locale}
          entity={entity}
          href={hrefFor(kind, entity.slug)}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  );
}

async function ScopedListing({
  locale,
  entity,
  href,
  searchParams,
}: {
  locale: Locale;
  entity: TaxonomyPage;
  href: ListingHref;
  searchParams: SearchParams;
}) {
  const params = await readListingParams(searchParams);
  return (
    <ListingResults
      locale={locale}
      scope={{ kind: entity.kind, id: entity.id }}
      href={href}
      params={params}
      hidden={entity.kind === 'family' ? { family: true } : undefined}
    />
  );
}
