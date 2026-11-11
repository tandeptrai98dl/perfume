import { describe, expect, it } from 'vitest';

import {
  computePaymentStatus,
  isRequirementCovered,
  nextSessionAmount,
  overpayment,
  refundableAmount,
  remittanceDifference,
  requiredOnlineAmount,
  sessionKind,
} from './status';
import { generateTxnRef, transferNote, TXN_REF_PATTERN } from './txn-ref';

describe('computePaymentStatus', () => {
  const total = 3_200_000;
  it.each([
    [0, 0, 'unpaid'],
    [640_000, 0, 'partially_paid'],
    [3_200_000, 0, 'paid'],
    [3_300_000, 0, 'paid'],
    [3_200_000, 200_000, 'partially_refunded'],
    [3_200_000, 3_200_000, 'refunded'],
    [640_000, 640_000, 'refunded'],
  ] as const)('paid %i, refunded %i → %s', (amountPaid, amountRefunded, expected) => {
    expect(computePaymentStatus({ total, amountPaid, amountRefunded })).toBe(expected);
  });

  it('a zero-total order that received nothing is unpaid, not paid', () => {
    expect(computePaymentStatus({ total: 0, amountPaid: 0, amountRefunded: 0 })).toBe('unpaid');
  });
});

describe('online requirement (ADR-0016)', () => {
  const cod = { paymentMethod: 'cod', total: 6_000_000, depositRequired: 1_200_000 };
  const online = { paymentMethod: 'payos', total: 6_000_000, depositRequired: 0 };

  it('needs the deposit for COD above the threshold and the total for online orders', () => {
    expect(requiredOnlineAmount(cod)).toBe(1_200_000);
    expect(requiredOnlineAmount({ ...cod, depositRequired: 0 })).toBe(0);
    expect(requiredOnlineAmount(online)).toBe(6_000_000);
  });

  it('is covered once enough money arrived, never for COD without deposit', () => {
    expect(isRequirementCovered({ ...cod, amountPaid: 1_199_000 })).toBe(false);
    expect(isRequirementCovered({ ...cod, amountPaid: 1_200_000 })).toBe(true);
    expect(isRequirementCovered({ ...cod, depositRequired: 0, amountPaid: 0 })).toBe(false);
    expect(isRequirementCovered({ ...online, amountPaid: 6_000_000 })).toBe(true);
  });

  it('asks only for the remainder in the next session', () => {
    expect(nextSessionAmount({ ...online, amountPaid: 1_000_000 })).toBe(5_000_000);
    expect(nextSessionAmount({ ...cod, amountPaid: 1_200_000 })).toBe(0);
    expect(sessionKind('cod')).toBe('deposit');
    expect(sessionKind('vnpay')).toBe('full');
  });
});

describe('refund and remittance math', () => {
  it('never refunds more than was paid minus refunded minus queued', () => {
    expect(refundableAmount({ amountPaid: 1_000_000, amountRefunded: 200_000 }, 300_000)).toBe(
      500_000,
    );
    expect(refundableAmount({ amountPaid: 100, amountRefunded: 100 }, 50)).toBe(0);
    expect(overpayment({ total: 500_000, amountPaid: 1_000_000 })).toBe(500_000);
    expect(overpayment({ total: 500_000, amountPaid: 400_000 })).toBe(0);
  });

  it('compares ticked orders minus the carrier fee with the bank receipt', () => {
    expect(
      remittanceDifference({
        orderAmounts: [1_500_000, 2_000_000],
        carrierFee: 35_000,
        totalAmount: 3_465_000,
      }),
    ).toEqual({ expected: 3_465_000, difference: 0 });
    expect(
      remittanceDifference({ orderAmounts: [1_000_000], carrierFee: 0, totalAmount: 990_000 }),
    ).toEqual({ expected: 1_000_000, difference: -10_000 });
  });
});

describe('transaction references', () => {
  it('are 16 digits: Vietnam-time stamp + random suffix, safe as a payOS orderCode', () => {
    const ref = generateTxnRef(new Date('2026-11-11T17:05:09Z'), () => 42);
    expect(ref).toBe('2611120005090042');
    expect(ref).toMatch(TXN_REF_PATTERN);
    expect(Number.isSafeInteger(Number(generateTxnRef(new Date('2089-12-31T00:00:00Z'))))).toBe(
      true,
    );
  });

  it('turns an order code into a bank-safe transfer note', () => {
    expect(transferNote('PF-261111-7K3Q')).toBe('PF2611117K3Q');
  });
});
