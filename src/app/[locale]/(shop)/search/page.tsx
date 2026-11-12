import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getListing } from '@/server/catalog-cache';

import { ListingResults, ListingSkeleton, readListingParams } from '../_lib/listing-results';
import { NOINDEX } from '../_lib/seo';
import { toListingFilters } from '@/lib/listing-params';
import { resolveLocale } from '@/app/[locale]/(shop)/_content/shared';

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/[locale]/search'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'search' });
  const { q } = await readListingParams(searchParams);
  return {
    title: q ? t('resultsFor', { query: q }) : t('title'),
    description: t('metaDescription'),
    robots: NOINDEX,
  };
}

/** Search results (§5.1: dynamic, noindex). Works without JavaScript through a GET form. */
export default async function SearchPage({ params, searchParams }: PageProps<'/[locale]/search'>) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'search' });
  return (
    <div className="container-content flex flex-col gap-10 py-10 lg:py-16">
      <h1 className="text-h1">{t('title')}</h1>
      <Suspense fallback={<ListingSkeleton />}>
        <SearchContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: PageProps<'/[locale]/search'>['searchParams'];
}) {
  const t = await getTranslations({ locale, namespace: 'search' });
  const params = await readListingParams(searchParams);
  const q = params.q.trim();

  const form = (
    <form
      role="search"
      action={getPathname({ locale, href: '/search' })}
      className="flex max-w-2xl gap-2"
    >
      <label htmlFor="search-page-q" className="sr-only">
        {t('label')}
      </label>
      <Input
        id="search-page-q"
        type="search"
        name="q"
        defaultValue={q}
        placeholder={t('placeholder')}
      />
      <Button type="submit">{t('submit')}</Button>
    </form>
  );

  if (!q) {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <p className="text-taupe-600">{t('prompt')}</p>
      </div>
    );
  }

  const sort = params.sort ?? 'relevance';
  const result = await getListing({
    locale,
    filters: toListingFilters(params),
    q,
    sort,
    page: params.page,
  });

  return (
    <div className="flex flex-col gap-6">
      {form}
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">{t('resultsFor', { query: q })}</h2>
        {result.fuzzy && result.total > 0 && <p className="text-taupe-600">{t('fuzzyNotice')}</p>}
      </div>
      <ListingResults
        locale={locale}
        scope={{ kind: 'all' }}
        href="/search"
        params={params}
        defaultSort="relevance"
        searchMode
        result={result}
      />
    </div>
  );
}
