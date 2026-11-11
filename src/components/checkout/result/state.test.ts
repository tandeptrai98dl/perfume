import { describe, expect, it } from 'vitest';

import { resultView } from './state';

const now = new Date('2026-11-11T08:00:00Z');
const later = new Date('2026-11-11T08:20:00Z');
const base = {
  status: 'pending',
  paymentStatus: 'unpaid' as const,
  paymentMethod: 'payos',
  onlineDue: 1_000_000,
  amountPaid: 0,
  reservedUntil: later,
  sessionUsable: true,
  attempts: 1,
  session: { provider: 'payos', qrCode: 'QR', checkoutUrl: null },
};

describe('checkout result view', () => {
  it('shows the QR or the VNPay button for a usable session', () => {
    expect(resultView(base, now)).toEqual({ state: 'awaitingPayment', panel: 'qr' });
    expect(
      resultView(
        { ...base, session: { provider: 'vnpay', qrCode: null, checkoutUrl: 'https://v' } },
        now,
      ),
    ).toEqual({ state: 'awaitingPayment', panel: 'vnpay' });
  });

  it('offers a retry after expiry while stock is held, nothing once the hold is over', () => {
    expect(resultView({ ...base, sessionUsable: false }, now)).toEqual({
      state: 'sessionExpired',
      panel: 'retry',
    });
    expect(resultView({ ...base, sessionUsable: false, attempts: 0 }, now)).toEqual({
      state: 'awaitingPayment',
      panel: 'start',
    });
    expect(resultView({ ...base, reservedUntil: now }, now)).toEqual({
      state: 'windowClosed',
      panel: null,
    });
  });

  it('asks for the difference after an admin edit raised a paid order (no stock hold)', () => {
    const edited = {
      ...base,
      status: 'confirmed',
      paymentStatus: 'partially_paid' as const,
      amountPaid: 3_000_000,
      onlineDue: 500_000,
      reservedUntil: null,
    };
    expect(resultView(edited, now)).toEqual({ state: 'balanceDue', panel: 'qr' });
    expect(resultView({ ...edited, sessionUsable: false, attempts: 0 }, now)).toEqual({
      state: 'balanceDue',
      panel: 'start',
    });
    expect(resultView({ ...edited, status: 'processing', sessionUsable: false }, now)).toEqual({
      state: 'balanceDue',
      panel: 'retry',
    });
    expect(resultView({ ...edited, onlineDue: 0, paymentStatus: 'paid' }, now)).toEqual({
      state: 'paid',
      panel: null,
    });
  });

  it('handles COD without deposit, deposit due, deposit paid', () => {
    const cod = { ...base, paymentMethod: 'cod', status: 'awaiting_confirmation' };
    expect(resultView({ ...cod, onlineDue: 0 }, now)).toEqual({ state: 'codConfirm', panel: null });
    expect(resultView({ ...cod, status: 'pending' }, now)).toEqual({
      state: 'depositRequired',
      panel: 'qr',
    });
    expect(
      resultView(
        {
          ...cod,
          status: 'confirmed',
          onlineDue: 0,
          amountPaid: 1,
          paymentStatus: 'partially_paid',
        },
        now,
      ),
    ).toEqual({ state: 'depositPaid', panel: null });
    expect(resultView({ ...cod, onlineDue: 0, amountPaid: 1 }, now).state).toBe(
      'codDepositReceived',
    );
  });

  it('shows paid, cancelled and other statuses without a panel', () => {
    expect(
      resultView({ ...base, status: 'confirmed', onlineDue: 0, paymentStatus: 'paid' }, now),
    ).toEqual({
      state: 'paid',
      panel: null,
    });
    expect(resultView({ ...base, status: 'cancelled' }, now).state).toBe('cancelled');
    expect(
      resultView({ ...base, status: 'shipped', onlineDue: 0, paymentStatus: 'refunded' }, now)
        .state,
    ).toBe('other');
  });
});
