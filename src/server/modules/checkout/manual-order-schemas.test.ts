import { describe, expect, it } from 'vitest';

import { mergeLineRequests } from './manual-lines';
import {
  customerLookupSchema,
  manualFollowUp,
  manualOrderSchema,
  manualPaymentMethod,
  mergeManualContact,
  type ManualOrderRawInput,
} from './manual-order-schemas';
import { decideInitialStatus, reservationExpiry } from './rules';

const VARIANT = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const RATE = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

function raw(overrides: Partial<ManualOrderRawInput> = {}): ManualOrderRawInput {
  return {
    checkoutKey: 'manual-key-1234567890',
    customer: { fullName: 'Nguyễn Văn A', phone: '+84 912 345 678', email: '', locale: 'en' },
    items: [{ variantId: VARIANT, quantity: 2 }],
    address: { provinceCode: '79', wardCode: '26734', street: '12 Lê Lợi' },
    shippingRateId: RATE,
    paymentOption: 'cod',
    ...overrides,
  };
}

const codes = (input: ManualOrderRawInput) => {
  const result = manualOrderSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
};

describe('manualOrderSchema', () => {
  it('normalizes the phone and fills defaults', () => {
    const parsed = manualOrderSchema.parse(raw());
    expect(parsed.customer.phone).toBe('0912345678');
    expect(parsed.customer.ref).toBeNull();
    expect(parsed.couponCode).toBeNull();
    expect(parsed.staffNote).toBeNull();
    expect(parsed.linkProvider).toBe('payos');
    expect(parsed.transfer).toEqual({ received: false, bankReference: '' });
  });

  it('requires a phone unless a lookup match was chosen', () => {
    const noPhone = raw({ customer: { fullName: 'An', phone: '', email: '', locale: 'vi' } });
    expect(codes(noPhone)).toContain('customer.phone:required');
    expect(
      codes({
        ...noPhone,
        customer: { ...noPhone.customer, ref: { type: 'user', id: VARIANT } },
      }),
    ).toEqual([]);
  });

  it('rejects invalid contact details, empty items and silly quantities', () => {
    expect(
      codes(raw({ customer: { fullName: 'An', phone: '0212345678', email: 'x@', locale: 'vi' } })),
    ).toEqual(['customer.phone:phoneInvalid', 'customer.email:emailInvalid']);
    expect(codes(raw({ items: [] }))).toEqual(['items:itemsRequired']);
    expect(codes(raw({ items: [{ variantId: VARIANT, quantity: 0 }] }))).toEqual([
      'items.0.quantity:tooSmall',
    ]);
    expect(codes(raw({ items: [{ variantId: VARIANT, quantity: 100 }] }))).toEqual([
      'items.0.quantity:tooLarge',
    ]);
  });

  it('needs the bank reference when a received transfer is recorded', () => {
    expect(
      codes(
        raw({ paymentOption: 'bank_transfer', transfer: { received: true, bankReference: '' } }),
      ),
    ).toEqual(['transfer.bankReference:required']);
    // Not received yet: nothing to reference.
    expect(codes(raw({ paymentOption: 'bank_transfer' }))).toEqual([]);
  });

  it('never accepts client prices', () => {
    const parsed = manualOrderSchema.parse({ ...raw(), total: 1, unitPrice: 1 } as never);
    expect(parsed).not.toHaveProperty('total');
    expect(parsed).not.toHaveProperty('unitPrice');
  });
});

describe('customerLookupSchema', () => {
  it('splits e-mail and phone queries', () => {
    expect(customerLookupSchema.parse({ query: ' Khach@Example.com ' })).toEqual({
      phone: null,
      email: 'khach@example.com',
    });
    expect(customerLookupSchema.parse({ query: '+84 912 345 678' })).toEqual({
      phone: '0912345678',
      email: null,
    });
  });
});

describe('manualPaymentMethod', () => {
  it('maps the form option to the order payment method', () => {
    expect(manualPaymentMethod('cod', 'vnpay')).toBe('cod');
    expect(manualPaymentMethod('bank_transfer', 'payos')).toBe('bank_transfer');
    expect(manualPaymentMethod('payment_link', 'vnpay')).toBe('vnpay');
    expect(manualPaymentMethod('payment_link', 'payos')).toBe('payos');
  });
});

describe('manualFollowUp', () => {
  const base = { provider: 'payos' as const, confirmNow: true, transferReceived: false };

  it('confirms COD on the phone only without a deposit (D16)', () => {
    expect(manualFollowUp({ ...base, option: 'cod', depositRequired: 0 })).toEqual({
      confirm: true,
      recordTransfer: false,
      paymentLink: null,
    });
    expect(
      manualFollowUp({ ...base, option: 'cod', depositRequired: 0, confirmNow: false }),
    ).toMatchObject({ confirm: false });
    expect(manualFollowUp({ ...base, option: 'cod', depositRequired: 1_080_000 })).toEqual({
      confirm: false,
      recordTransfer: false,
      paymentLink: 'payos',
    });
  });

  it('records a transfer only when it was received', () => {
    expect(manualFollowUp({ ...base, option: 'bank_transfer', depositRequired: 0 })).toEqual({
      confirm: false,
      recordTransfer: false,
      paymentLink: null,
    });
    expect(
      manualFollowUp({
        ...base,
        option: 'bank_transfer',
        depositRequired: 0,
        transferReceived: true,
      }),
    ).toMatchObject({ recordTransfer: true });
  });

  it('hands out a link for online payment', () => {
    expect(
      manualFollowUp({ ...base, option: 'payment_link', provider: 'vnpay', depositRequired: 0 }),
    ).toEqual({ confirm: false, recordTransfer: false, paymentLink: 'vnpay' });
  });
});

describe('mergeManualContact', () => {
  const typed = { fullName: 'Trần B', phone: '', email: '', locale: 'vi' as const };

  it('fills phone and e-mail from the chosen match; typed values win', () => {
    const match = { userId: 'u1', phone: '0987654321', email: 'b@example.com' };
    expect(mergeManualContact(typed, match)).toEqual({
      ok: true,
      contact: {
        userId: 'u1',
        fullName: 'Trần B',
        phone: '0987654321',
        email: 'b@example.com',
        locale: 'vi',
      },
    });
    expect(
      mergeManualContact({ ...typed, phone: '0912345678', email: 'new@example.com' }, match),
    ).toMatchObject({ contact: { phone: '0912345678', email: 'new@example.com', userId: 'u1' } });
  });

  it('allows no e-mail but never no phone', () => {
    expect(mergeManualContact({ ...typed, phone: '0912345678' }, null)).toMatchObject({
      ok: true,
      contact: { email: '', userId: null },
    });
    expect(mergeManualContact(typed, { userId: 'u1', phone: null, email: 'b@x.vn' })).toEqual({
      ok: false,
      field: 'phone',
    });
  });
});

describe('manual order statuses and reservations', () => {
  const settings = {
    checkout: { onlineReservationMinutes: 30, paymentSessionMinutes: 15 },
    cod: { confirmationWindowHours: 24 },
  } as Parameters<typeof reservationExpiry>[1];
  const now = new Date('2026-11-12T03:00:00.000Z');

  it('bank transfers wait for money (pending) but hold stock for the staff window', () => {
    expect(decideInitialStatus('bank_transfer', 0)).toBe('pending');
    expect(reservationExpiry('pending', settings, now, 'bank_transfer').toISOString()).toBe(
      '2026-11-13T03:00:00.000Z',
    );
    expect(reservationExpiry('pending', settings, now, 'payos').toISOString()).toBe(
      '2026-11-12T03:30:00.000Z',
    );
  });

  it('merges repeated variants', () => {
    expect(
      mergeLineRequests([
        { variantId: 'a', quantity: 1 },
        { variantId: 'b', quantity: 2 },
        { variantId: 'a', quantity: 3 },
      ]),
    ).toEqual([
      { variantId: 'a', quantity: 4 },
      { variantId: 'b', quantity: 2 },
    ]);
  });
});
