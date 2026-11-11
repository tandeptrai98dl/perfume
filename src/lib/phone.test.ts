import { describe, expect, it } from 'vitest';

import { isVietnamesePhone, normalizeVietnamesePhone } from './phone';

describe('normalizeVietnamesePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['091 234 5678', '0912345678'],
    ['091.234.5678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['+84 91 234 5678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0387654321', '0387654321'],
    ['0567654321', '0567654321'],
    ['0707654321', '0707654321'],
    ['0812345678', '0812345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeVietnamesePhone(input)).toBe(expected);
  });

  it.each(['', '091234567', '09123456789', '0212345678', '1912345678', 'abc', '+1 912345678'])(
    'rejects %s',
    (input) => {
      expect(normalizeVietnamesePhone(input)).toBeNull();
      expect(isVietnamesePhone(input)).toBe(false);
    },
  );
});
