import { describe, expect, it } from 'vitest';

import { dateRangeBounds, parseOrderListFilters, shipOrderSchema } from './admin-schemas';
import {
  canViewContact,
  contactView,
  depositSatisfied,
  orderMoneySummary,
  packingSlipView,
  partialEmail,
  partialPhone,
  staffNextStatuses,
  staffOrderActor,
} from './admin-view';

describe('staff → state machine actor', () => {
  it('maps orders.cancelPaid (Owner/Manager) to the manager actor', () => {
    expect(staffOrderActor({ id: 'o', role: 'owner' })).toEqual({
      type: 'staff',
      id: 'o',
      isManager: true,
    });
    expect(staffOrderActor({ id: 'm', role: 'manager' }).isManager).toBe(true);
    expect(staffOrderActor({ id: 's', role: 'staff' }).isManager).toBe(false);
  });

  it('offers only the valid transition buttons for the role', () => {
    expect(staffNextStatuses('awaiting_confirmation', 'staff')).toEqual(['confirmed', 'cancelled']);
    expect(staffNextStatuses('confirmed', 'staff')).toEqual(['processing']);
    expect(staffNextStatuses('confirmed', 'manager')).toEqual(['processing', 'cancelled']);
    expect(staffNextStatuses('processing', 'owner')).toEqual(['shipped', 'cancelled']);
    expect(staffNextStatuses('shipped', 'staff')).toEqual(['delivered', 'delivery_failed']);
    // `pending → confirmed` is automatic (payment); staff may only cancel.
    expect(staffNextStatuses('pending', 'staff')).toEqual(['cancelled']);
    expect(staffNextStatuses('completed', 'owner')).toEqual([]);
    // Returns use the return panel, not the generic buttons.
    expect(staffNextStatuses('delivered', 'owner')).toEqual([]);
    expect(staffNextStatuses('return_requested', 'owner')).toEqual([]);
    expect(staffNextStatuses('awaiting_confirmation', 'editor')).toEqual([]);
    // A deposit already paid: only Manager/Owner may cancel.
    expect(staffNextStatuses('awaiting_confirmation', 'staff', 500_000)).toEqual(['confirmed']);
    expect(staffNextStatuses('awaiting_confirmation', 'owner', 500_000)).toEqual([
      'confirmed',
      'cancelled',
    ]);
  });
});

describe('contact masking', () => {
  it('masks phone and email for roles without the contact permission', () => {
    expect(partialPhone('0912345678')).toBe('091****678');
    expect(partialPhone('+84 912 345 678')).toBe('849*****678');
    expect(partialPhone('123')).toBe('***');
    expect(partialEmail('khach.hang@example.com')).toBe('k***@example.com');
    expect(partialEmail('broken')).toBe('***');
    expect(canViewContact('staff')).toBe(true);
    expect(canViewContact('editor')).toBe(false);
    expect(contactView({ phone: '0912345678', email: 'a@b.vn' }, 'editor')).toEqual({
      phone: '091****678',
      email: 'a***@b.vn',
      masked: true,
    });
    expect(contactView({ phone: '0912345678', email: 'a@b.vn' }, 'manager').masked).toBe(false);
  });
});

describe('money figures', () => {
  const base = {
    status: 'awaiting_confirmation' as const,
    paymentMethod: 'cod',
    total: 6_000_000,
    depositRequired: 1_200_000,
    amountPaid: 0,
    amountRefunded: 0,
  };

  it('guards COD confirmation on the deposit', () => {
    expect(depositSatisfied(base)).toBe(false);
    expect(depositSatisfied({ ...base, amountPaid: 1_200_000 })).toBe(true);
    expect(depositSatisfied({ depositRequired: 0, amountPaid: 0 })).toBe(true);
  });

  it('computes amount due, deposit outstanding, COD to collect and refund owed', () => {
    expect(orderMoneySummary({ ...base, amountPaid: 1_200_000 })).toEqual({
      amountDue: 4_800_000,
      depositRequired: 1_200_000,
      depositOutstanding: 0,
      codToCollect: 4_800_000,
      refundOwed: 0,
    });
    expect(
      orderMoneySummary({ ...base, paymentMethod: 'vnpay', depositRequired: 0 }),
    ).toMatchObject({ codToCollect: 0, depositOutstanding: 0 });
    expect(
      orderMoneySummary({
        ...base,
        status: 'cancelled',
        amountPaid: 1_200_000,
        amountRefunded: 200_000,
      }),
    ).toMatchObject({ refundOwed: 1_000_000, codToCollect: 0 });
  });
});

describe('packing slip', () => {
  const items = [
    {
      sku: 'A',
      productName: 'A',
      variantLabel: '100ml',
      quantity: 2,
      unitPrice: 1_000_000,
      lineTotal: 2_000_000,
    },
    {
      sku: 'B',
      productName: 'B',
      variantLabel: '50ml',
      quantity: 1,
      unitPrice: 500_000,
      lineTotal: 450_000,
    },
  ];
  const totals = {
    subtotal: 2_500_000,
    discountTotal: 50_000,
    shippingFee: 30_000,
    giftWrapFee: 50_000,
    total: 2_530_000,
  };

  it('shows prices and totals by default', () => {
    const view = packingSlipView({ ...totals, hidePrices: false }, items);
    expect(view.showPrices).toBe(true);
    expect(view.units).toBe(3);
    expect(view.totals).toEqual(totals);
    expect(view.lines[1]).toMatchObject({ unitPrice: 500_000, lineTotal: 450_000 });
  });

  it('hides every price on gift orders', () => {
    const view = packingSlipView({ ...totals, hidePrices: true }, items);
    expect(view.totals).toBeNull();
    expect(view.lines.every((line) => line.unitPrice === null && line.lineTotal === null)).toBe(
      true,
    );
  });
});

describe('order list filters', () => {
  it('keeps valid values and drops unknown ones', () => {
    expect(
      parseOrderListFilters({
        tab: 'toPack',
        status: 'shipped',
        paymentStatus: 'nope',
        paymentMethod: ['cod', 'vnpay'],
        province: '79',
        from: '2026-11-01',
        to: '2026-13-45',
      }),
    ).toEqual({
      tab: 'toPack',
      status: 'shipped',
      paymentStatus: null,
      paymentMethod: 'cod',
      province: '79',
      from: '2026-11-01',
      to: null,
    });
    expect(parseOrderListFilters({ province: 'x1', tab: 'other' })).toMatchObject({
      tab: null,
      province: null,
    });
  });

  it('turns an inclusive Vietnam-time date range into UTC bounds', () => {
    expect(dateRangeBounds({ from: '2026-11-01', to: '2026-11-01' })).toEqual({
      start: new Date('2026-10-31T17:00:00.000Z'),
      end: new Date('2026-11-01T17:00:00.000Z'),
    });
    expect(dateRangeBounds({ from: null, to: null })).toEqual({ start: null, end: null });
  });

  it('normalises tracking codes', () => {
    const parsed = shipOrderSchema.parse({
      orderId: '019a0000-0000-7000-8000-000000000000',
      expectedVersion: 2,
      carrier: 'ghn',
      trackingCode: ' gyb7k9x2 ',
    });
    expect(parsed.trackingCode).toBe('GYB7K9X2');
    expect(
      shipOrderSchema.safeParse({ ...parsed, trackingCode: 'a b' }).error?.issues[0]?.message,
    ).toBe('trackingCodeInvalid');
  });
});
