import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';

import { TaxonomyListContent } from '../../_lib/taxonomy-pages';

export default function AdminTaxonomyListPage({ searchParams }: PageProps<'/admin/catalog/notes'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TaxonomyListContent kind="note" searchParams={searchParams} />
    </Suspense>
  );
}
