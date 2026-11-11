import { describe, expect, it } from 'vitest';

import { priceCart } from './pricing';
import {
  checkCartLines,
  couponRedemptionAmount,
  decideInitialStatus,
  formatAddressLine,
  isHighValueCod,
  reservationExpiry,
} from './rules';
import { variantLabel } from './labels';

const settings = {
  cod: { maxOrderWithoutDeposit: 5_000_000, depositPercent: 20, confirmationWindowHours: 24 },
  checkout: { paymentSessionMinutes: 15, onlineReservationMinutes: 30 },
};

describe('decideInitialStatus', () => {
  it('online payments wait for money', () => {
    expect(decideInitialStatus('payos', 0)).toBe('pending');
    expect(decideInitialStatus('vnpay', 0)).toBe('pending');
  });
  it('COD without deposit waits for staff confirmation', () => {
    expect(decideInitialStatus('cod', 0)).toBe('awaiting_confirmation');
  });
  it('COD with a deposit waits for the deposit payment (ADR-0016)', () => {
    expect(decideInitialStatus('cod', 1_100_000)).toBe('pending');
  });
});

describe('reservationExpiry (ADR-0006)', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  it('holds stock 30 minutes while waiting for a payment', () => {
    expect(reservationExpiry('pending', settings, now).toISOString()).toBe(
      '2026-11-11T10:30:00.000Z',
    );
  });
  it('holds stock 24 hours for COD awaiting confirmation', () => {
    expect(reservationExpiry('awaiting_confirmation', settings, now).toISOString()).toBe(
      '2026-11-12T10:00:00.000Z',
    );
  });
});

describe('deposit rule wiring', () => {
  const line = {
    variantId: 'v1',
    productId: 'p1',
    brandId: 'b1',
    categoryIds: [],
    compareAtPrice: null,
    weightG: 400,
  };
  const price = (unitPrice: number, method: 'cod' | 'online') =>
    priceCart({
      lines: [{ ...line, unitPrice, quantity: 1 }],
      shippingRate: { fee: 30_000, freeOverSubtotal: null },
      cod: { maxOrderWithoutDeposit: 5_000_000, depositPercent: 20 },
      paymentMethod: method,
    });

  it('needs no deposit at or below the threshold', () => {
    const result = price(4_970_000, 'cod'); // total 5,000,000
    expect(result.total).toBe(5_000_000);
    expect(result.depositRequired).toBe(0);
    expect(decideInitialStatus('cod', result.depositRequired)).toBe('awaiting_confirmation');
    expect(isHighValueCod('cod', result.total, settings)).toBe(false);
  });

  it('asks 20% (rounded up to 1,000 ₫) above the threshold and alerts staff', () => {
    const result = price(5_400_000, 'cod'); // total 5,430,000
    expect(result.depositRequired).toBe(1_086_000);
    expect(decideInitialStatus('cod', result.depositRequired)).toBe('pending');
    expect(isHighValueCod('cod', result.total, settings)).toBe(true);
  });

  it('never asks a deposit for online payment', () => {
    const result = price(5_400_000, 'online');
    expect(result.depositRequired).toBe(0);
    expect(isHighValueCod('payos', result.total, settings)).toBe(false);
  });
});

describe('checkCartLines', () => {
  const base = { quantity: 1, available: 3, purchasable: true };
  it('accepts lines within limits', () => {
    expect(checkCartLines([{ variantId: 'a', ...base }], 5)).toEqual([]);
  });
  it('reports one precise issue per line', () => {
    expect(
      checkCartLines(
        [
          { variantId: 'a', ...base, purchasable: false },
          { variantId: 'b', ...base, quantity: 6, available: 10 },
          { variantId: 'c', ...base, quantity: 4 },
          { variantId: 'd', ...base },
        ],
        5,
      ),
    ).toEqual([
      { path: 'items.a', code: 'itemUnavailable' },
      { path: 'items.b', code: 'itemQuantityLimit' },
      { path: 'items.c', code: 'itemInsufficientStock' },
    ]);
  });
});

describe('helpers', () => {
  it('records the value the coupon granted', () => {
    expect(couponRedemptionAmount('percent', { discountTotal: 200_000, shippingDiscount: 0 })).toBe(
      200_000,
    );
    expect(
      couponRedemptionAmount('free_shipping', { discountTotal: 0, shippingDiscount: 30_000 }),
    ).toBe(30_000);
  });

  it('formats the invoice address', () => {
    expect(
      formatAddressLine({
        street: '12 Lê Lợi',
        wardName: 'Phường Bến Thành',
        provinceName: 'Thành phố Hồ Chí Minh',
      }),
    ).toBe('12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh');
  });

  it('labels variants in the order locale', () => {
    expect(variantLabel('vi', 'full_size', 100)).toMatch(/100/);
    expect(variantLabel('en', 'travel', 10)).toBe('Travel 10 ml');
    expect(variantLabel('en', 'decant', 5)).toBe('5 ml');
  });
});
