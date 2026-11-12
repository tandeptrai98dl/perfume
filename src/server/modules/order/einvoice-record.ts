import { and, eq, isNull } from 'drizzle-orm';

import { orders } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

/**
 * Stores the issued e-invoice on the order (D13). The order module owns `orders`; the einvoice
 * module calls this inside its issuing transaction. Write-once: returns false when the order
 * already has an invoice (never overwritten). Does not bump `version` (not a staff edit).
 */
export async function recordEinvoiceIssued(
  tx: Pick<Tx, 'update'>,
  input: { orderId: string; ref: string; issuedAt: Date },
): Promise<boolean> {
  const updated = await tx
    .update(orders)
    .set({ einvoiceRef: input.ref, einvoiceIssuedAt: input.issuedAt })
    .where(and(eq(orders.id, input.orderId), isNull(orders.einvoiceRef)))
    .returning({ id: orders.id });
  return updated.length > 0;
}
