import { describe, expect, it } from 'vitest';

import { couponSchema, couponState } from './admin-schemas';

describe('couponState', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  const base = { isActive: true, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0 };

  it('derives the display state from switch, dates and usage', () => {
    expect(couponState(base, now)).toBe('active');
    expect(couponState({ ...base, isActive: false }, now)).toBe('inactive');
    expect(couponState({ ...base, startsAt: new Date('2026-12-01T00:00:00Z') }, now)).toBe(
      'scheduled',
    );
    expect(couponState({ ...base, endsAt: new Date('2026-11-01T00:00:00Z') }, now)).toBe('expired');
    expect(couponState({ ...base, usageLimit: 5, usedCount: 5 }, now)).toBe('expired');
  });
});

describe('couponSchema', () => {
  it('normalises codes and drops fields that do not apply to the type', () => {
    const fixed = couponSchema.parse({
      code: ' sale-50k ',
      type: 'fixed',
      value: 50_000,
      maxDiscount: 10_000,
    });
    expect(fixed).toMatchObject({
      code: 'SALE-50K',
      value: 50_000,
      maxDiscount: null,
      scope: { brandIds: [], categoryIds: [], productIds: [] },
      isActive: true,
    });
  });

  it('rejects a per-customer limit above the total limit', () => {
    const result = couponSchema.safeParse({
      code: 'LIMIT',
      type: 'percent',
      value: 10,
      usageLimit: 1,
      perCustomerLimit: 2,
    });
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['perCustomerLimit', 'tooLarge'],
    ]);
  });
});
