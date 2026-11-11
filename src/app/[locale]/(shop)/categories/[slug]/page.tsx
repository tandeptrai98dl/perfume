import type { Metadata } from 'next';

import type { Locale } from '@/i18n/routing';

import { placeholderParams } from '../../_lib/seo';
import { TaxonomyListingPage, taxonomyMetadata } from '../../_lib/taxonomy-page';

export const generateStaticParams = placeholderParams;
/** The page awaits its slug outside Suspense on purpose (see PLACEHOLDER_SLUG). */
export const instant = false;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/[locale]/categories/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  return taxonomyMetadata('category', locale as Locale, slug, searchParams);
}

export default function CategoriesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/categories/[slug]'>) {
  return <TaxonomyListingPage kind="category" params={params} searchParams={searchParams} />;
}
