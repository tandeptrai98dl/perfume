import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';

import { PrintPage } from '../../_print';

/** Bulk print from the orders list: `/admin/orders/print/packing-slip?ids=a,b`. */
export default function BulkPrintPage(props: PageProps<'/admin/orders/print/[document]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: PageProps<'/admin/orders/print/[document]'>) {
  const { document } = await params;
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw.join(',') : (raw ?? '')).split(',').filter(Boolean);
  return <PrintPage document={document} ids={ids} backHref="/admin/orders" />;
}
