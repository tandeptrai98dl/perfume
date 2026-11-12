import type { ReturnReceivedMetadata } from '@/server/modules/order';

import type { InvoiceOrder, InvoiceOrderItem } from './build';

/*
 * What the customer finally bought, for invoicing (pure): the order snapshot minus the
 * accepted returns recorded in its timeline (`return_received`, ADR-0017). A replacement swaps
 * goods for the same goods, so it changes nothing. Returned units leave their line with the
 * amount refunded for them; the original shipping and gift-wrap fees leave the invoice when
 * they were refunded (whole order returned for the shop's fault). Return-shipping
 * reimbursements are a cost of the shop, not a sale, so they never reduce the invoice.
 * Totals stay consistent: the result's `total` is the sum of its lines and fees, which is what
 * `buildEinvoiceDocument` checks.
 */

export type InvoiceItemWithId = InvoiceOrderItem & { id: string };

export function invoiceAfterReturns(
  order: InvoiceOrder,
  items: readonly InvoiceItemWithId[],
  returns: readonly ReturnReceivedMetadata[],
): { order: InvoiceOrder; items: InvoiceOrderItem[] } {
  const accepted = returns.filter((entry) => entry.outcome !== 'replacement');
  if (accepted.length === 0) return { order, items: [...items] };

  const returned = new Map<string, { quantity: number; amount: number }>();
  for (const entry of accepted) {
    for (const line of entry.lines) {
      const current = returned.get(line.orderItemId) ?? { quantity: 0, amount: 0 };
      returned.set(line.orderItemId, {
        quantity: current.quantity + line.quantity,
        amount: current.amount + line.amount,
      });
    }
  }
  const feesRefunded = accepted.some((entry) => entry.feesRefunded);

  const kept: InvoiceOrderItem[] = [];
  for (const item of items) {
    const back = returned.get(item.id);
    if (!back) {
      kept.push(item);
      continue;
    }
    const quantity = item.quantity - back.quantity;
    if (quantity <= 0) continue;
    const lineTotal = Math.max(0, item.lineTotal - back.amount);
    // The coupon share follows the units kept; never more than the kept goods' list price.
    const discountAllocated = Math.min(
      Math.max(0, item.unitPrice * quantity - lineTotal),
      item.discountAllocated,
    );
    kept.push({ ...item, quantity, lineTotal, discountAllocated });
  }

  const shippingFee = feesRefunded ? 0 : order.shippingFee;
  const giftWrapFee = feesRefunded ? 0 : order.giftWrapFee;
  const subtotal = kept.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountTotal = kept.reduce((sum, item) => sum + item.discountAllocated, 0);
  const merchandise = kept.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    order: {
      ...order,
      subtotal,
      discountTotal,
      shippingFee,
      giftWrapFee,
      total: merchandise + shippingFee + giftWrapFee,
    },
    items: kept,
  };
}
