import { describe, expect, it } from 'vitest';

import { currentIssuedInvoice } from './adjustments';
import { invoiceAfterReturns } from './after-returns';
import { buildEinvoiceDocument, type InvoiceOrder } from './build';
import { invoiceLabels } from './labels';
import { einvoiceAdjustmentStatus, type EinvoiceAdjustmentEventRow } from './state';

const order: InvoiceOrder = {
  id: '0192f3a4-0000-7000-8000-000000000001',
  code: 'PF-261112-7K3Q',
  customerName: 'Nguyễn Thị Hương',
  email: 'huong@example.com',
  phone: '0912345678',
  subtotal: 5_000_000,
  discountTotal: 500_000,
  shippingFee: 30_000,
  giftWrapFee: 50_000,
  total: 4_580_000,
  vatInvoice: null,
};
const items = [
  {
    id: 'a',
    sku: 'CED-100',
    productName: 'Cèdre Nocturne',
    variantLabel: '100 ml',
    unitPrice: 2_000_000,
    quantity: 2,
    discountAllocated: 400_000,
    lineTotal: 3_600_000,
  },
  {
    id: 'b',
    sku: 'ROS-50',
    productName: 'Rose Absolue',
    variantLabel: '50 ml',
    unitPrice: 1_000_000,
    quantity: 1,
    discountAllocated: 100_000,
    lineTotal: 900_000,
  },
];

function received(
  lines: { orderItemId: string; quantity: number; amount: number }[],
  extra: { feesRefunded?: boolean; outcome?: 'full' | 'partial' | 'replacement' } = {},
) {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    requestId: 'r1',
    outcome: extra.outcome ?? ('partial' as const),
    lines: lines.map((line) => ({ ...line, variantId: `v-${line.orderItemId}` })),
    feesRefunded: extra.feesRefunded ?? false,
    restocked: true,
    refund: {
      merchandise: total,
      shipping: 0,
      giftWrap: 0,
      returnShipping: 0,
      total,
      refundId: null,
      queued: total,
      deferred: 0,
      payout: 0,
      payoutRefundId: null,
      shortfall: 0,
    },
  };
}

describe('invoiceAfterReturns', () => {
  it('keeps the order unchanged without returns or for a replacement', () => {
    expect(invoiceAfterReturns(order, items, []).order).toEqual(order);
    const replaced = invoiceAfterReturns(order, items, [
      received([{ orderItemId: 'b', quantity: 1, amount: 0 }], { outcome: 'replacement' }),
    ]);
    expect(replaced.order.total).toBe(order.total);
    expect(replaced.items).toHaveLength(2);
  });

  it('removes returned units with their refunded amount; totals still build', () => {
    const kept = invoiceAfterReturns(order, items, [
      received([
        { orderItemId: 'a', quantity: 1, amount: 1_800_000 },
        { orderItemId: 'b', quantity: 1, amount: 900_000 },
      ]),
    ]);
    expect(kept.items).toEqual([
      expect.objectContaining({ sku: 'CED-100', quantity: 1, lineTotal: 1_800_000 }),
    ]);
    expect(kept.items[0]!.discountAllocated).toBe(200_000);
    expect(kept.order).toMatchObject({ shippingFee: 30_000, giftWrapFee: 50_000 });
    expect(kept.order.total).toBe(1_800_000 + 30_000 + 50_000);
    const document = buildEinvoiceDocument({
      order: kept.order,
      items: kept.items,
      shippingAddress: null,
      vatRatePercent: 10,
      issueDate: new Date('2026-11-12T03:00:00Z'),
      labels: invoiceLabels(),
    });
    expect(document.totals.grossAmount).toBe(kept.order.total);
    expect(document.lines.map((line) => line.kind)).toEqual(['goods', 'service', 'service']);
  });

  it('drops the fees when they were refunded and leaves nothing after a full fault return', () => {
    const kept = invoiceAfterReturns(order, items, [
      received(
        [
          { orderItemId: 'a', quantity: 2, amount: 3_600_000 },
          { orderItemId: 'b', quantity: 1, amount: 900_000 },
        ],
        { feesRefunded: true, outcome: 'full' },
      ),
    ]);
    expect(kept.items).toEqual([]);
    expect(kept.order.total).toBe(0);
  });

  it('a change-of-mind full return keeps the shipping service invoiced', () => {
    const kept = invoiceAfterReturns(order, items, [
      received(
        [
          { orderItemId: 'a', quantity: 2, amount: 3_600_000 },
          { orderItemId: 'b', quantity: 1, amount: 900_000 },
        ],
        { outcome: 'full' },
      ),
    ]);
    expect(kept.items).toEqual([]);
    expect(kept.order.total).toBe(80_000);
  });
});

describe('einvoiceAdjustmentStatus', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 3, minutes));
  const event = (
    type: string,
    metadata: Record<string, unknown>,
    minutes: number,
    message: string | null = null,
  ): EinvoiceAdjustmentEventRow => ({ type, metadata, message, createdAt: at(minutes) });

  it('allows an adjustment of an issued invoice', () => {
    expect(einvoiceAdjustmentStatus({ einvoiceRef: 'C26SBX-1' }, [])).toMatchObject({
      state: 'none',
      canAdjust: true,
    });
    expect(einvoiceAdjustmentStatus({ einvoiceRef: null }, []).canAdjust).toBe(false);
  });

  it('tracks a request through retries to the result', () => {
    const request = event(
      'einvoice_adjust_requested',
      { adjustmentId: 'x', action: 'replace' },
      1,
      'Khách trả hàng',
    );
    const retrying = einvoiceAdjustmentStatus({ einvoiceRef: 'C26SBX-1' }, [
      request,
      event('einvoice_adjust_attempt_failed', { adjustmentId: 'x', reason: 'timeout' }, 2),
    ]);
    expect(retrying).toMatchObject({
      state: 'retrying',
      action: 'replace',
      attempts: 1,
      reason: 'timeout',
      requestReason: 'Khách trả hàng',
      canAdjust: false,
    });
    const replaced = einvoiceAdjustmentStatus({ einvoiceRef: 'C26SBX-2' }, [
      request,
      event('einvoice_replaced', { adjustmentId: 'x', ref: 'C26SBX-2' }, 3),
    ]);
    expect(replaced).toMatchObject({ state: 'replaced', canAdjust: true });
    const failed = einvoiceAdjustmentStatus({ einvoiceRef: 'C26SBX-1' }, [
      request,
      event('einvoice_adjust_failed', { adjustmentId: 'x', reason: 'misa:Invalid' }, 3),
    ]);
    expect(failed).toMatchObject({ state: 'failed', canAdjust: true, attempts: 1 });
  });

  it('a cancelled invoice is final, even when it overtook a replacement', () => {
    const status = einvoiceAdjustmentStatus({ einvoiceRef: 'C26SBX-1' }, [
      event('einvoice_adjust_requested', { adjustmentId: 'x', action: 'replace' }, 1),
      event('einvoice_adjust_requested', { adjustmentId: 'y', action: 'cancel' }, 2),
      event('einvoice_cancelled', { adjustmentId: 'y', ref: 'C26SBX-1' }, 3),
    ]);
    expect(status).toMatchObject({ state: 'cancelled', canAdjust: false });
  });
});

describe('currentIssuedInvoice', () => {
  const issued = {
    type: 'einvoice_issued',
    metadata: {
      provider: 'sandbox',
      invoiceNo: 'SBX1',
      series: 'C26SBX',
      templateCode: '1',
      transactionId: 'SBX-1',
      lookupCode: 'SBX1',
      issuedAt: '2026-11-10T03:00:00.000Z',
    },
    createdAt: new Date('2026-11-10T03:00:00Z'),
  };

  it('is the original invoice (refId = order id) until a replacement exists', () => {
    expect(currentIssuedInvoice('order-1', [issued], [])).toMatchObject({
      refId: 'order-1',
      invoiceNo: 'SBX1',
      provider: 'sandbox',
    });
    const replacement = {
      type: 'einvoice_replaced',
      message: null,
      metadata: { ...issued.metadata, invoiceNo: 'SBX2', refId: 'ref-2' },
      createdAt: new Date('2026-11-12T03:00:00Z'),
    };
    expect(currentIssuedInvoice('order-1', [issued], [replacement])).toMatchObject({
      refId: 'ref-2',
      invoiceNo: 'SBX2',
    });
  });

  it('is null without an invoice', () => {
    expect(currentIssuedInvoice('order-1', [], [])).toBeNull();
  });
});
