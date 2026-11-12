import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  defaultResellable,
  foldReturnEvents,
  isFullReturn,
  lineRefundAmount,
  planReturnRefund,
  resolutionsFor,
  returnEligibility,
  validateReturnLines,
  type ReturnEventRow,
  type ReturnOrderLine,
} from './rules';
import { returnRequestSchema } from './schemas';

const delivered = new Date('2026-11-01T03:00:00Z');
const items: ReturnOrderLine[] = [
  { id: 'a', variantId: 'va', quantity: 2, lineTotal: 2_999_999 },
  { id: 'b', variantId: 'vb', quantity: 1, lineTotal: 1_500_000 },
];

describe('returnEligibility', () => {
  const base = { status: 'delivered', deliveredAt: delivered, windowDays: 7, hasRequest: false };

  it('is open until the end of the window, counted from delivery', () => {
    const deadline = new Date(delivered.getTime() + 7 * DAY_MS);
    expect(returnEligibility({ ...base, now: new Date(delivered.getTime() + DAY_MS) })).toEqual({
      eligible: true,
      deadline,
    });
    expect(returnEligibility({ ...base, now: deadline }).eligible).toBe(true);
    expect(returnEligibility({ ...base, now: new Date(deadline.getTime() + 1) })).toEqual({
      eligible: false,
      reason: 'windowExpired',
      deadline,
    });
  });

  it('honours the configured window', () => {
    const now = new Date(delivered.getTime() + 10 * DAY_MS);
    expect(returnEligibility({ ...base, now }).eligible).toBe(false);
    expect(returnEligibility({ ...base, windowDays: 14, now }).eligible).toBe(true);
  });

  it('needs a delivered order and a single request', () => {
    const now = new Date(delivered.getTime() + DAY_MS);
    expect(returnEligibility({ ...base, status: 'shipped', deliveredAt: null, now })).toMatchObject(
      {
        eligible: false,
        reason: 'notDelivered',
      },
    );
    expect(returnEligibility({ ...base, status: 'returned', now })).toMatchObject({
      reason: 'notDelivered',
    });
    expect(returnEligibility({ ...base, status: 'completed', now })).toMatchObject({
      reason: 'windowExpired',
    });
    expect(returnEligibility({ ...base, hasRequest: true, now })).toMatchObject({
      reason: 'alreadyRequested',
    });
  });
});

describe('lines', () => {
  it('validates lines and quantities', () => {
    expect(validateReturnLines(items, [{ orderItemId: 'a', quantity: 2 }])).toEqual([]);
    expect(validateReturnLines(items, [])).toEqual([{ path: 'lines', code: 'noLines' }]);
    expect(validateReturnLines(items, [{ orderItemId: 'x', quantity: 1 }])).toEqual([
      { path: 'lines.0', code: 'unknownLine' },
    ]);
    expect(validateReturnLines(items, [{ orderItemId: 'a', quantity: 3 }])).toEqual([
      { path: 'lines.0.quantity', code: 'quantityTooLarge' },
    ]);
    expect(
      validateReturnLines(items, [
        { orderItemId: 'b', quantity: 1 },
        { orderItemId: 'b', quantity: 1 },
      ]),
    ).toEqual([{ path: 'lines.1', code: 'duplicateLine' }]);
  });

  it('knows a full return', () => {
    const all = [
      { orderItemId: 'a', quantity: 2 },
      { orderItemId: 'b', quantity: 1 },
    ];
    expect(isFullReturn(items, all)).toBe(true);
    expect(isFullReturn(items, [{ orderItemId: 'a', quantity: 2 }])).toBe(false);
    expect(isFullReturn(items, [{ ...all[0]!, quantity: 1 }, all[1]!])).toBe(false);
  });

  it('pro-rates a line in whole đồng, exact for the whole line', () => {
    expect(lineRefundAmount(items[0]!, 2)).toBe(2_999_999);
    expect(lineRefundAmount(items[0]!, 1)).toBe(1_499_999);
  });
});

describe('planReturnRefund', () => {
  const order = { items, shippingFee: 30_000, giftWrapFee: 50_000 };
  const all = [
    { orderItemId: 'a', quantity: 2 },
    { orderItemId: 'b', quantity: 1 },
  ];

  it('change of mind refunds the goods only, never shipping', () => {
    const plan = planReturnRefund({
      ...order,
      lines: all,
      reason: 'unopened',
      resolution: 'refund',
      returnShippingFee: 40_000,
    });
    expect(plan).toMatchObject({
      outcome: 'full',
      feesRefunded: false,
      merchandise: 4_499_999,
      shipping: 0,
      giftWrap: 0,
      returnShipping: 0,
      total: 4_499_999,
    });
  });

  it("refunds 100 % plus return shipping for the shop's fault", () => {
    const plan = planReturnRefund({
      ...order,
      lines: all,
      reason: 'defective',
      resolution: 'refund',
      returnShippingFee: 40_000,
    });
    expect(plan).toMatchObject({
      outcome: 'full',
      feesRefunded: true,
      shipping: 30_000,
      giftWrap: 50_000,
      returnShipping: 40_000,
      total: 4_499_999 + 30_000 + 50_000 + 40_000,
    });
  });

  it('partial fault return: lines + return shipping, original fees stay', () => {
    const plan = planReturnRefund({
      ...order,
      lines: [{ orderItemId: 'a', quantity: 1 }],
      reason: 'damaged',
      resolution: 'refund',
      returnShippingFee: 25_000,
    });
    expect(plan).toMatchObject({
      outcome: 'partial',
      feesRefunded: false,
      merchandise: 1_499_999,
      returnShipping: 25_000,
      total: 1_524_999,
    });
    expect(plan.lines).toEqual([
      { orderItemId: 'a', quantity: 1, variantId: 'va', amount: 1_499_999 },
    ]);
  });

  it('a replacement refunds nothing', () => {
    const plan = planReturnRefund({
      ...order,
      lines: [{ orderItemId: 'b', quantity: 1 }],
      reason: 'wrong_item',
      resolution: 'replacement',
      returnShippingFee: 25_000,
    });
    expect(plan).toMatchObject({ outcome: 'replacement', total: 0 });
    expect(plan.lines[0]!.amount).toBe(0);
  });

  it('offers replacement only for the shop’s fault', () => {
    expect(resolutionsFor('unopened')).toEqual(['refund']);
    expect(resolutionsFor('defective')).toEqual(['refund', 'replacement']);
    expect(defaultResellable('unopened')).toBe(true);
    expect(defaultResellable('damaged')).toBe(false);
  });
});

describe('returnRequestSchema', () => {
  const line = { orderItemId: '0192f3a4-b5c6-7d8e-9f01-23456789abcd', quantity: 1 };

  it('needs the seal for a change of mind, refund only', () => {
    const result = returnRequestSchema.safeParse({ lines: [line], reason: 'unopened' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(['sealRequired']);
    expect(
      returnRequestSchema.safeParse({
        lines: [line],
        reason: 'unopened',
        sealIntact: true,
        resolution: 'replacement',
      }).error?.issues[0]?.message,
    ).toBe('refundOnly');
    expect(
      returnRequestSchema.safeParse({ lines: [line], reason: 'unopened', sealIntact: true })
        .success,
    ).toBe(true);
  });

  it("needs a description of the problem for the shop's fault", () => {
    expect(
      returnRequestSchema.safeParse({ lines: [line], reason: 'defective', description: 'hỏng' })
        .error?.issues[0]?.message,
    ).toBe('describeProblem');
    expect(
      returnRequestSchema.safeParse({
        lines: [line],
        reason: 'defective',
        resolution: 'replacement',
        description: 'Vòi xịt bị kẹt, không xịt được.',
      }).success,
    ).toBe(true);
  });
});

describe('foldReturnEvents', () => {
  const at = (minutes: number) => new Date(delivered.getTime() + minutes * 60_000);
  const requested: ReturnEventRow = {
    id: '1',
    type: 'return_requested',
    message: 'Vòi xịt bị kẹt',
    metadata: {
      requestId: 'r1',
      reason: 'defective',
      resolution: 'refund',
      lines: [{ orderItemId: 'a', quantity: 1 }],
      sealIntact: false,
    },
    createdAt: at(1),
  };

  it('is null without a request', () => {
    expect(foldReturnEvents([])).toBeNull();
  });

  it('follows request → approved → received', () => {
    const state = foldReturnEvents([
      requested,
      {
        id: '2',
        type: 'return_approved',
        message: 'GHN lấy hàng ngày mai',
        metadata: { requestId: 'r1' },
        createdAt: at(2),
      },
      {
        id: '3',
        type: 'return_received',
        message: null,
        metadata: {
          requestId: 'r1',
          outcome: 'partial',
          lines: [{ orderItemId: 'a', quantity: 1, variantId: 'va', amount: 100 }],
          feesRefunded: false,
          restocked: false,
          refund: {
            merchandise: 100,
            shipping: 0,
            giftWrap: 0,
            returnShipping: 0,
            total: 100,
            refundId: null,
            queued: 60,
            shortfall: 40,
          },
        },
        createdAt: at(3),
      },
    ]);
    expect(state).toMatchObject({
      requestId: 'r1',
      status: 'received',
      description: 'Vòi xịt bị kẹt',
      approvalNote: 'GHN lấy hàng ngày mai',
      outcome: 'partial',
      restocked: false,
      refund: { total: 100, queued: 60, shortfall: 40 },
    });
  });

  it('records a rejection and ignores other requests’ events', () => {
    const state = foldReturnEvents([
      requested,
      {
        id: '2',
        type: 'return_approved',
        message: null,
        metadata: { requestId: 'other' },
        createdAt: at(2),
      },
      {
        id: '3',
        type: 'return_rejected',
        message: 'Sản phẩm đã sử dụng',
        metadata: { requestId: 'r1' },
        createdAt: at(3),
      },
    ]);
    expect(state).toMatchObject({
      status: 'rejected',
      approvedAt: null,
      rejectionReason: 'Sản phẩm đã sử dụng',
    });
  });

  it('never marks a request received before it was approved', () => {
    const state = foldReturnEvents([
      requested,
      {
        id: '2',
        type: 'return_received',
        message: null,
        metadata: { requestId: 'r1' },
        createdAt: at(2),
      },
    ]);
    expect(state?.status).toBe('requested');
  });
});
