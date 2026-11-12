import { describe, expect, it } from 'vitest';

import { buildStaffAlert, STAFF_ALERT_KINDS } from './staff-alerts';

/** Intl puts a no-break space between the amount and "₫". */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

const PII = ['Nguyễn Thị Hương', '0912345678', 'huong@example.com', '12 Hàng Bạc'];

describe('buildStaffAlert', () => {
  it('formats a new-order alert with code, amount, method and province only', () => {
    const alert = buildStaffAlert({
      kind: 'new_order',
      appUrl: 'https://shop.test/',
      order: {
        id: '0190f6b6-0000-7000-8000-000000000001',
        code: 'PF-261111-7K3Q',
        total: 6_250_000,
        paymentMethod: 'cod',
        provinceName: 'Thành phố Hà Nội',
      },
    });
    expect(alert.title).toBe('Đơn hàng mới');
    expect(alert.text).toContain('PF-261111-7K3Q');
    expect(plain(alert.text)).toContain('6.250.000 ₫');
    expect(alert.text).toContain('Thành phố Hà Nội');
    expect(alert.text).toContain('COD');
    expect(alert.adminUrl).toBe(
      'https://shop.test/admin/orders/0190f6b6-0000-7000-8000-000000000001',
    );
    for (const value of PII) expect(alert.text).not.toContain(value);
  });

  it('never needs more than the order snapshot: personal fields are not even accepted', () => {
    const order = {
      id: 'x',
      code: 'PF-261111-AAAA',
      total: 100,
      paymentMethod: 'vnpay' as const,
      provinceName: null,
      // Extra fields a careless caller might pass are ignored by the formatter.
      customerName: PII[0],
      phone: PII[1],
      email: PII[2],
      street: PII[3],
    };
    const alert = buildStaffAlert({ kind: 'high_value_cod', appUrl: 'https://s', order });
    for (const value of PII) expect(alert.text).not.toContain(value);
    expect(alert.lines.map(plain)).toEqual(['Đơn PF-261111-AAAA: 100 ₫ · VNPay']);
  });

  it.each(STAFF_ALERT_KINDS)('has a Vietnamese title for %s', (kind) => {
    const alert = buildStaffAlert({ kind, appUrl: 'https://s', message: 'chi tiết' });
    expect(alert.title.length).toBeGreaterThan(3);
    expect(alert.lines).toEqual(['chi tiết']);
    expect(alert.adminUrl).toBe('https://s/admin');
  });

  it('formats a low-stock alert with SKU, availability and a link to the variant', () => {
    const alert = buildStaffAlert({
      kind: 'low_stock',
      appUrl: 'https://shop.test/',
      details: {
        kind: 'low_stock',
        variantId: 'v1',
        sku: 'CHN-BLEU-100',
        productName: 'Bleu de Chanel EDP',
        available: 2,
        threshold: 3,
      },
    });
    expect(alert.title).toBe('Sắp hết hàng');
    expect(alert.lines).toEqual(['CHN-BLEU-100 · Bleu de Chanel EDP: còn 2 có thể bán (ngưỡng 3)']);
    expect(alert.adminUrl).toBe('https://shop.test/admin/inventory/movements?variant=v1');
  });

  it('summarises pending reviews and links the moderation queue', () => {
    const alert = buildStaffAlert({
      kind: 'review_pending',
      appUrl: 'https://s',
      details: { kind: 'review_pending', pending: 4 },
    });
    expect(alert.title).toBe('Đánh giá chờ duyệt');
    expect(alert.lines).toEqual(['4 đánh giá đang chờ kiểm duyệt']);
    expect(alert.adminUrl).toBe('https://s/admin/reviews');
  });

  it('names a dead-lettered job by queue and id only', () => {
    const alert = buildStaffAlert({
      kind: 'job_failed',
      appUrl: 'https://s',
      details: {
        kind: 'job_failed',
        job: 'order.placed',
        id: '0190f6b6-0000-7000-8000-000000000009',
        attempts: 6,
      },
    });
    expect(alert.lines[0]).toContain('order.placed');
    expect(alert.lines[0]).toContain('0190f6b6-0000-7000-8000-000000000009');
    expect(alert.lines[0]).toContain('6 lần thử');
  });
});
