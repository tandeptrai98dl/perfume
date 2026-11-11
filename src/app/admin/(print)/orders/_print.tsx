import { notFound } from 'next/navigation';

import { PrintDocuments } from '@/components/admin/orders/print-documents';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  getPrintableOrders,
  MAX_BULK_ORDERS,
  PRINT_DOCUMENTS,
  type PrintDocument,
} from '@/server/modules/order';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared by the single-order and bulk print routes. Slips carry the full phone and address. */
export async function PrintPage({
  document,
  ids,
  backHref,
}: {
  document: string;
  ids: string[];
  backHref: string;
}) {
  await requireAdminPage('customers.viewContactInOrder');
  if (!(PRINT_DOCUMENTS as readonly string[]).includes(document)) notFound();
  const valid = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, MAX_BULK_ORDERS);
  const orders = await getPrintableOrders(getDb(), valid);
  return (
    <PrintDocuments document={document as PrintDocument} orders={orders} backHref={backHref} />
  );
}
