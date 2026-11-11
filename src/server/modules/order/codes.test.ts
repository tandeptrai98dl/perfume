import { describe, expect, it } from 'vitest';

import { generateOrderCode, ORDER_CODE_PATTERN } from './codes';

describe('generateOrderCode', () => {
  it('uses the Vietnam date and an unambiguous suffix', () => {
    // 2026-11-11 20:30 UTC is 2026-11-12 in Vietnam.
    const code = generateOrderCode(new Date('2026-11-11T20:30:00Z'), () => 0);
    expect(code).toBe('PF-261112-2222');
    expect(code).toMatch(ORDER_CODE_PATTERN);
  });

  it('never contains 0, O, 1, I or L', () => {
    for (let i = 0; i < 200; i += 1) expect(generateOrderCode()).toMatch(ORDER_CODE_PATTERN);
  });
});
