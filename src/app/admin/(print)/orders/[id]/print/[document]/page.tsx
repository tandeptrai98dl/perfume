import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageSkeleton } from '@/components/admin/page-skeleton';

import { PrintPage } from '../../../_print';

/** `/admin/orders/[id]/print/packing-slip` and `/delivery-slip`. */
export default function OrderPrintPage(props: PageProps<'/admin/orders/[id]/print/[document]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/orders/[id]/print/[document]'>) {
  const { id, document } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <PrintPage document={document} ids={[id]} backHref={`/admin/orders/${id}`} />;
}
