import { describe, expect, it } from 'vitest';

import { JOBS } from '@/server/jobs/definitions';

import { buildEinvoiceDocument, InvoiceBuildError, taxableOf, type InvoiceOrder } from './build';
import { invoiceLabels } from './labels';
import {
  attemptsSinceRetry,
  EINVOICE_EVENTS,
  EINVOICE_MAX_ATTEMPTS,
  einvoiceStatus,
  type EinvoiceEventRow,
} from './state';

const labels = invoiceLabels();
const issueDate = new Date('2026-11-12T03:00:00Z');

const order: InvoiceOrder = {
  id: '01970000-0000-7000-8000-000000000001',
  code: 'PF-261112-7K3Q',
  customerName: 'Nguyễn Thị Hương',
  email: 'huong@example.com',
  phone: '0912345678',
  subtotal: 4_400_000,
  discountTotal: 440_000,
  shippingFee: 30_000,
  giftWrapFee: 50_000,
  total: 4_040_000,
  vatInvoice: null,
};

const items = [
  {
    sku: 'CED-100',
    productName: 'Cèdre Nocturne EDT',
    variantLabel: '100 ml',
    unitPrice: 3_200_000,
    quantity: 1,
    discountAllocated: 320_000,
    lineTotal: 2_880_000,
  },
  {
    sku: 'ROS-30',
    productName: 'Rose Velours EDP',
    variantLabel: '30 ml',
    unitPrice: 600_000,
    quantity: 2,
    discountAllocated: 120_000,
    lineTotal: 1_080_000,
  },
];

function build(overrides: Partial<InvoiceOrder> = {}, rate = 10) {
  return buildEinvoiceDocument({
    order: { ...order, ...overrides },
    items,
    shippingAddress: '12 Lê Lợi, Phường Bến Thành, TP Hồ Chí Minh',
    vatRatePercent: rate,
    issueDate,
    labels,
  });
}

describe('buildEinvoiceDocument', () => {
  it('splits VAT-inclusive lines and fees so the invoice total is exactly the order total', () => {
    const doc = build();
    expect(doc.refId).toBe(order.id);
    expect(doc.lines.map((l) => [l.kind, l.name, l.grossAmount])).toEqual([
      ['goods', 'Cèdre Nocturne EDT 100 ml', 2_880_000],
      ['goods', 'Rose Velours EDP 30 ml', 1_080_000],
      ['service', labels.shipping, 30_000],
      ['service', labels.giftWrap, 50_000],
    ]);
    const [first] = doc.lines;
    expect(first).toMatchObject({
      lineNumber: 1,
      code: 'CED-100',
      quantity: 1,
      unitName: labels.unitGoods,
      amountNet: 2_909_091, // 3,200,000 / 1.1
      taxableAmount: 2_618_182, // 2,880,000 / 1.1
      discountNet: 290_909,
      vatRate: 10,
      vatAmount: 261_818,
    });
    for (const line of doc.lines) {
      expect(Number.isInteger(line.taxableAmount) && Number.isInteger(line.vatAmount)).toBe(true);
      expect(line.taxableAmount + line.vatAmount).toBe(line.grossAmount);
      expect(line.amountNet - line.discountNet).toBe(line.taxableAmount);
    }
    expect(doc.totals.grossAmount).toBe(order.total);
    expect(doc.totals.taxableAmount + doc.totals.vatAmount).toBe(order.total);
    expect(doc.taxBreakdown).toEqual([
      { vatRate: 10, taxableAmount: doc.totals.taxableAmount, vatAmount: doc.totals.vatAmount },
    ]);
    expect(doc.totalInWords).toBe('Bốn triệu không trăm bốn mươi nghìn đồng');
    expect(doc.note).toContain(order.code);
    expect(doc.paymentMethodName).toBe(labels.paymentMethod);
  });

  it('uses the configured VAT rate (pending accountant confirmation)', () => {
    const doc = build({}, 8);
    expect(doc.lines.every((l) => l.vatRate === 8)).toBe(true);
    expect(doc.lines[0]!.taxableAmount).toBe(taxableOf(2_880_000, 8));
    expect(doc.totals.grossAmount).toBe(order.total);
  });

  it('omits zero fees (free shipping, no gift wrap)', () => {
    const doc = build({ shippingFee: 0, giftWrapFee: 0, total: 3_960_000 });
    expect(doc.lines.map((l) => l.kind)).toEqual(['goods', 'goods']);
  });

  it('issues a company invoice with the tax code when VAT details were given', () => {
    const doc = build({
      vatInvoice: {
        companyName: 'Công ty TNHH Hương Thơm',
        taxCode: '0312345678',
        email: 'ketoan@huongthom.vn',
        address: '1 Nguyễn Huệ, Phường Sài Gòn, TP Hồ Chí Minh',
      },
    });
    expect(doc.buyer).toEqual({
      kind: 'company',
      name: order.customerName,
      legalName: 'Công ty TNHH Hương Thơm',
      taxCode: '0312345678',
      address: '1 Nguyễn Huệ, Phường Sài Gòn, TP Hồ Chí Minh',
      email: 'ketoan@huongthom.vn',
      phone: order.phone,
    });
  });

  it('issues an individual invoice otherwise (no e-mail on manual orders is fine)', () => {
    const doc = build({ email: '' });
    expect(doc.buyer).toMatchObject({
      kind: 'individual',
      legalName: null,
      taxCode: null,
      email: null,
      address: '12 Lê Lợi, Phường Bến Thành, TP Hồ Chí Minh',
    });
  });

  it('refuses a snapshot whose lines do not add up to the order total', () => {
    expect(() => build({ total: 4_040_001 })).toThrow(InvoiceBuildError);
  });
});

describe('e-invoice state', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 3, minutes));
  const event = (type: string, minutes: number, metadata: Record<string, unknown> = {}) =>
    ({ type, createdAt: at(minutes), metadata }) satisfies EinvoiceEventRow;
  const delivered = { status: 'delivered', deliveredAt: at(0), einvoiceRef: null };

  it('matches the job retry policy: first try + every pg-boss retry', () => {
    expect(EINVOICE_MAX_ATTEMPTS).toBe(JOBS['einvoice.issue'].queue.retryLimit + 1);
  });

  it('is not applicable before delivery and pending right after', () => {
    expect(
      einvoiceStatus({ status: 'shipped', deliveredAt: null, einvoiceRef: null }, []).state,
    ).toBe('not_applicable');
    expect(einvoiceStatus(delivered, [])).toMatchObject({ state: 'pending', canRetry: true });
  });

  it('counts failed tries since the last manual retry', () => {
    const events = [
      event(EINVOICE_EVENTS.attemptFailed, 1, { reason: 'timeout' }),
      event(EINVOICE_EVENTS.failed, 2, { reason: 'misa:InvalidTaxCode' }),
      event(EINVOICE_EVENTS.retryRequested, 3),
      event(EINVOICE_EVENTS.attemptFailed, 4, { reason: 'timeout' }),
    ];
    expect(attemptsSinceRetry(events)).toBe(1);
    expect(einvoiceStatus(delivered, events)).toMatchObject({
      state: 'retrying',
      attempts: 1,
      reason: 'timeout',
      canRetry: false,
    });
    expect(einvoiceStatus(delivered, events.slice(0, 2))).toMatchObject({
      state: 'failed',
      attempts: 2,
      reason: 'misa:InvalidTaxCode',
      canRetry: true,
    });
  });

  it('is issued once the order carries the reference, and never retried', () => {
    const status = einvoiceStatus({ ...delivered, einvoiceRef: 'C26TAA-12' }, [
      event(EINVOICE_EVENTS.issued, 1),
    ]);
    expect(status).toMatchObject({ state: 'issued', canRetry: false });
  });

  it('does not offer a retry once the order left the delivered states', () => {
    const status = einvoiceStatus({ ...delivered, status: 'returned' }, [
      event(EINVOICE_EVENTS.failed, 1),
    ]);
    expect(status).toMatchObject({ state: 'failed', canRetry: false });
  });
});
