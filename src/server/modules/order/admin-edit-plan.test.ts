import { describe, expect, it } from 'vitest';

import type { PricingCoupon } from '@/server/modules/checkout/pricing';
import { editPaymentEffect } from '@/server/modules/payment/adjustments';

import {
  buildEditLines,
  canEditOrder,
  diffAddress,
  diffLines,
  diffTotals,
  nextDepositRequired,
  repriceOrder,
  stockChanges,
  stockModeFor,
  type CatalogVariant,
  type CurrentLine,
  type EditAddress,
} from './admin-edit-plan';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const C = '00000000-0000-7000-8000-00000000000c';

function variant(id: string, overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    variantId: id,
    productId: `p-${id}`,
    brandId: 'brand-1',
    categoryIds: [],
    productName: `Product ${id.slice(-1)}`,
    variantLabel: '100 ml',
    sku: `SKU-${id.slice(-1)}`,
    imageUrl: null,
    price: 2_000_000,
    compareAtPrice: null,
    weightG: 400,
    available: 5,
    purchasable: true,
    ...overrides,
  };
}

function line(id: string, quantity: number, unitPrice = 1_500_000): CurrentLine {
  return {
    variantId: id,
    productId: `p-${id}`,
    productName: `Snapshot ${id.slice(-1)}`,
    variantLabel: '100 ml',
    sku: `SKU-${id.slice(-1)}`,
    imageUrl: null,
    unitPrice,
    compareAtPrice: null,
    quantity,
  };
}

const catalog = new Map([A, B, C].map((id) => [id, variant(id)]));
const cod = { maxOrderWithoutDeposit: 5_000_000, depositPercent: 20 };

describe('editable statuses', () => {
  it('allows edits before shipment only', () => {
    expect(canEditOrder('pending')).toBe(true);
    expect(canEditOrder('awaiting_confirmation')).toBe(true);
    expect(canEditOrder('confirmed')).toBe(true);
    expect(canEditOrder('processing')).toBe(true);
    for (const status of ['shipped', 'delivered', 'cancelled', 'returned'] as const) {
      expect(canEditOrder(status)).toBe(false);
    }
  });

  it('adjusts reservations before confirmation and committed stock after', () => {
    expect(stockModeFor('pending')).toBe('reserved');
    expect(stockModeFor('awaiting_confirmation')).toBe('reserved');
    expect(stockModeFor('confirmed')).toBe('committed');
    expect(stockModeFor('processing')).toBe('committed');
  });
});

describe('buildEditLines', () => {
  it('keeps the snapshot price of kept lines and prices new lines from the catalogue', () => {
    const { lines, issues } = buildEditLines(
      [line(A, 1)],
      [
        { variantId: A, quantity: 2 },
        { variantId: B, quantity: 1 },
      ],
      catalog,
      5,
    );
    expect(issues).toEqual([]);
    expect(lines.map((l) => [l.variantId, l.unitPrice, l.quantity, l.isNew])).toEqual([
      [A, 1_500_000, 2, false],
      [B, 2_000_000, 1, true],
    ]);
    expect(lines[0]!.productName).toBe('Snapshot a');
    expect(lines[1]!.productName).toBe('Product b');
  });

  it('refuses increases beyond stock, the line cap, or of variants no longer sold', () => {
    const limited = new Map(catalog);
    limited.set(B, variant(B, { available: 1 }));
    limited.set(C, variant(C, { purchasable: false }));
    const { issues } = buildEditLines(
      [line(A, 1), line(C, 1)],
      [
        { variantId: A, quantity: 6 },
        { variantId: B, quantity: 2 },
        { variantId: C, quantity: 2 },
      ],
      limited,
      5,
    );
    expect(issues).toEqual([
      { path: 'items.0.quantity', code: 'itemQuantityLimit' },
      { path: 'items.1.quantity', code: 'itemInsufficientStock' },
      { path: 'items.2.quantity', code: 'itemUnavailable' },
    ]);
  });

  it('lets a line of a discontinued variant stay or shrink', () => {
    const gone = new Map([[A, variant(A, { purchasable: false, available: 0 })]]);
    expect(buildEditLines([line(A, 3)], [{ variantId: A, quantity: 2 }], gone, 5).issues).toEqual(
      [],
    );
  });

  it('flags unknown variants', () => {
    const { issues } = buildEditLines([], [{ variantId: C, quantity: 1 }], new Map(), 5);
    expect(issues).toEqual([{ path: 'items.0.variantId', code: 'notFound' }]);
  });
});

describe('stockChanges and diffLines', () => {
  const current = [line(A, 2), line(B, 1)];
  const requested = [
    { variantId: A, quantity: 3 },
    { variantId: C, quantity: 1 },
  ];

  it('computes per-variant deltas sorted by variant id', () => {
    expect(stockChanges(current, requested)).toEqual([
      { variantId: A, delta: 1 },
      { variantId: B, delta: -1 },
      { variantId: C, delta: 1 },
    ]);
    expect(
      stockChanges(current, [
        { variantId: A, quantity: 2 },
        { variantId: B, quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('lists added, removed and changed lines', () => {
    const { lines } = buildEditLines(current, requested, catalog, 5);
    expect(diffLines(current, lines).map((d) => [d.variantId, d.from, d.to])).toEqual([
      [A, 2, 3],
      [B, 1, null],
      [C, null, 1],
    ]);
  });
});

describe('diffAddress', () => {
  const before: EditAddress = {
    fullName: 'Nguyễn Văn A',
    phone: '0912345678',
    provinceCode: '01',
    provinceName: 'Hà Nội',
    wardCode: '00004',
    wardName: 'Ba Đình',
    street: '1 Hoàng Hoa Thám',
  };
  it('returns only changed fields with before/after', () => {
    expect(diffAddress(before, { ...before, street: '2 Hoàng Hoa Thám' })).toEqual({
      street: { from: '1 Hoàng Hoa Thám', to: '2 Hoàng Hoa Thám' },
    });
    expect(diffAddress(before, before)).toEqual({});
  });
});

describe('repriceOrder', () => {
  const lines = buildEditLines(
    [line(A, 1, 3_000_000)],
    [
      { variantId: A, quantity: 1 },
      { variantId: B, quantity: 1 },
    ],
    catalog,
    5,
  ).lines;
  const base = {
    lines,
    coupon: null,
    shippingRate: { fee: 30_000, freeOverSubtotal: null },
    shippingFeeOverride: null,
    giftWrap: { enabled: false, fee: 0 },
    cod,
    paymentMethod: 'cod',
  };

  it('recomputes subtotal, shipping and the COD deposit (integer VND)', () => {
    const { totals, couponDropped } = repriceOrder(base);
    expect(couponDropped).toBeNull();
    expect(totals).toMatchObject({
      subtotal: 5_000_000,
      discountTotal: 0,
      shippingFee: 30_000,
      total: 5_030_000,
      depositRequired: 1_006_000,
    });
  });

  it('keeps a coupon whose terms still hold and drops one that no longer applies', () => {
    const coupon: PricingCoupon = {
      code: 'SALE10',
      type: 'percent',
      value: 10,
      maxDiscount: null,
      minSubtotal: 4_000_000,
      scope: {},
      excludeSaleItems: false,
    };
    const kept = repriceOrder({ ...base, coupon });
    expect(kept.couponDropped).toBeNull();
    expect(kept.totals.discountTotal).toBe(500_000);
    expect(kept.totals.couponAmount).toBe(500_000);
    expect(Object.values(kept.totals.lineDiscounts).reduce((a, b) => a + b, 0)).toBe(500_000);

    const dropped = repriceOrder({ ...base, lines: lines.slice(0, 1), coupon });
    expect(dropped.couponDropped).toEqual({ code: 'SALE10', reason: 'min_subtotal' });
    expect(dropped.totals.discountTotal).toBe(0);
    expect(dropped.totals.couponAmount).toBe(0);
  });

  it('applies a shipping fee override after the free-shipping rules', () => {
    const { totals } = repriceOrder({
      ...base,
      paymentMethod: 'vnpay',
      shippingRate: { fee: 30_000, freeOverSubtotal: 1_000_000 },
      shippingFeeOverride: 50_000,
    });
    expect(totals.shippingFee).toBe(50_000);
    expect(totals.total).toBe(5_050_000);
    expect(totals.depositRequired).toBe(0);
  });
});

describe('nextDepositRequired', () => {
  it('uses the recomputed deposit before confirmation, never more after it', () => {
    expect(nextDepositRequired('awaiting_confirmation', 1_200_000, 0)).toBe(1_200_000);
    expect(nextDepositRequired('confirmed', 1_200_000, 1_000_000)).toBe(1_000_000);
    expect(nextDepositRequired('processing', 0, 1_000_000)).toBe(0);
  });
});

describe('diffTotals', () => {
  it('keeps only changed amounts', () => {
    const before = {
      subtotal: 1,
      discountTotal: 0,
      shippingFee: 3,
      giftWrapFee: 0,
      total: 4,
      depositRequired: 0,
    };
    expect(diffTotals(before, { ...before, total: 5, subtotal: 2 })).toEqual({
      subtotal: { from: 1, to: 2 },
      total: { from: 4, to: 5 },
    });
  });
});

describe('editPaymentEffect', () => {
  const paid = {
    paymentMethod: 'vnpay',
    depositRequired: 0,
    amountPaid: 3_000_000,
    amountRefunded: 0,
    openRefunds: 0,
  };

  it('asks for the difference when a prepaid order grows', () => {
    expect(editPaymentEffect({ ...paid, total: 3_500_000 })).toEqual({
      paymentStatus: 'partially_paid',
      onlineDue: 500_000,
      refund: 0,
    });
  });

  it('refunds the excess when it shrinks, net of refunds already queued', () => {
    expect(editPaymentEffect({ ...paid, total: 2_000_000 })).toMatchObject({
      paymentStatus: 'paid',
      onlineDue: 0,
      refund: 1_000_000,
    });
    expect(editPaymentEffect({ ...paid, total: 2_000_000, openRefunds: 400_000 }).refund).toBe(
      600_000,
    );
  });

  it('COD: only the deposit is due online', () => {
    expect(
      editPaymentEffect({
        paymentMethod: 'cod',
        total: 6_000_000,
        depositRequired: 1_200_000,
        amountPaid: 1_000_000,
        amountRefunded: 0,
        openRefunds: 0,
      }),
    ).toEqual({ paymentStatus: 'partially_paid', onlineDue: 200_000, refund: 0 });
  });
});
