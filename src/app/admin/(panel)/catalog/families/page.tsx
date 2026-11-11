import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';

import { TaxonomyListContent } from '../../_lib/taxonomy-pages';

export default function AdminTaxonomyListPage({
  searchParams,
}: PageProps<'/admin/catalog/families'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TaxonomyListContent kind="family" searchParams={searchParams} />
    </Suspense>
  );
}
