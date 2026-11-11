import { describe, expect, it } from 'vitest';

import {
  formatVietnamesePhone,
  isVietnameseMobile,
  isVietnamesePhone,
  normalizeVietnamesePhone,
  parseVietnamesePhone,
} from './phone';

describe('normalizeVietnamesePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['(091) 234-5678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0084912345678', '0912345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeVietnamesePhone(input)).toBe(expected);
  });

  it('keeps non-phone input for validation to reject', () => {
    expect(normalizeVietnamesePhone(' abc ')).toBe('abc');
  });
});

describe('isVietnameseMobile', () => {
  it.each([
    '0321234567', // Viettel 032
    '0391234567', // Viettel 039
    '0861234567', // Viettel 086
    '0961234567',
    '0971234567',
    '0981234567',
    '0811234567', // Vinaphone
    '0851234567',
    '0881234567',
    '0911234567',
    '0941234567',
    '0701234567', // MobiFone
    '0761234567',
    '0791234567',
    '0891234567',
    '0901234567',
    '0931234567',
    '0521234567', // Vietnamobile
    '0561234567',
    '0581234567',
    '0921234567',
    '0591234567', // Gmobile
    '0991234567',
    '0551234567', // Reddi
    '0871234567', // iTel
    '+84 912 345 678',
  ])('accepts %s', (phone) => {
    expect(isVietnameseMobile(phone)).toBe(true);
  });

  it.each([
    '', // empty
    '091234567', // 9 digits
    '09123456789', // 11 digits
    '01234567890', // pre-2018 11-digit form
    '0281234567', // landline (Ho Chi Minh City)
    '0241234567', // landline (Hanoi)
    '0951234567', // retired S-Fone range
    '0801234567', // unassigned
    '0311234567', // unassigned 031
    '0511234567',
    '0711234567',
    '1912345678',
    '09123456ab',
    '+1 912 345 678',
  ])('rejects %s', (phone) => {
    expect(isVietnameseMobile(phone)).toBe(false);
  });
});

describe('formatVietnamesePhone', () => {
  it('groups digits 4-3-3', () => {
    expect(formatVietnamesePhone('+84912345678')).toBe('0912 345 678');
  });
  it('leaves unknown formats alone', () => {
    expect(formatVietnamesePhone('12345')).toBe('12345');
  });
});

describe('parseVietnamesePhone (account forms)', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['091.234.5678', '0912345678'],
    ['+84 91 234 5678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0387654321', '0387654321'],
    ['0567654321', '0567654321'],
    ['0707654321', '0707654321'],
    ['0812345678', '0812345678'],
  ])('accepts %s', (input, expected) => {
    expect(parseVietnamesePhone(input)).toBe(expected);
  });

  it.each(['', '091234567', '09123456789', '0212345678', '1912345678', 'abc', '+1 912345678'])(
    'rejects %s',
    (input) => {
      expect(parseVietnamesePhone(input)).toBeNull();
      expect(isVietnamesePhone(input)).toBe(false);
    },
  );
});
