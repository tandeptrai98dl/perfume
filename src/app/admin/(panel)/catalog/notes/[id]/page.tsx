import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';

import { TaxonomyEditContent } from '../../../_lib/taxonomy-pages';

export default function AdminTaxonomyEditPage({ params }: PageProps<'/admin/catalog/notes/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TaxonomyEditContent kind="note" params={params} />
    </Suspense>
  );
}
