import type { Metadata } from 'next';

import type { Locale } from '@/i18n/routing';

import { placeholderParams } from '../../_lib/seo';
import { TaxonomyListingPage, taxonomyMetadata } from '../../_lib/taxonomy-page';

export const generateStaticParams = placeholderParams;
/** Blocks on the slug lookup so unknown slugs return a real 404 (see PLACEHOLDER_SLUG). */
export const instant = false;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/[locale]/collections/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  return taxonomyMetadata('collection', locale as Locale, slug, searchParams);
}

export default function CollectionsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/collections/[slug]'>) {
  return <TaxonomyListingPage kind="collection" params={params} searchParams={searchParams} />;
}
