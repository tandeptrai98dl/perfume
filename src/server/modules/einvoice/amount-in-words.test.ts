import { describe, expect, it } from 'vitest';

import { amountInWords } from './amount-in-words';
import { invoiceLabels } from './labels';

const words = invoiceLabels().words;
const read = (n: number) => amountInWords(n, words);

describe('amountInWords (Vietnamese)', () => {
  it.each([
    [0, 'Không đồng'],
    [5, 'Năm đồng'],
    [10, 'Mười đồng'],
    [15, 'Mười lăm đồng'],
    [21, 'Hai mươi mốt đồng'],
    [24, 'Hai mươi tư đồng'],
    [25, 'Hai mươi lăm đồng'],
    [105, 'Một trăm linh năm đồng'],
    [110, 'Một trăm mười đồng'],
    [1_000, 'Một nghìn đồng'],
    [1_005, 'Một nghìn không trăm linh năm đồng'],
    [50_000, 'Năm mươi nghìn đồng'],
    [1_250_000, 'Một triệu hai trăm năm mươi nghìn đồng'],
    [3_200_000, 'Ba triệu hai trăm nghìn đồng'],
    [10_050_000, 'Mười triệu không trăm năm mươi nghìn đồng'],
    [1_000_000_000, 'Một tỷ đồng'],
    [2_000_001_000, 'Hai tỷ không trăm linh một nghìn đồng'],
    [1_000_000_000_000, 'Một nghìn tỷ đồng'],
  ])('%i → %s', (amount, expected) => {
    expect(read(amount)).toBe(expected);
  });

  it('refuses fractions and negatives (money is whole đồng)', () => {
    expect(() => read(1.5)).toThrow(RangeError);
    expect(() => read(-1)).toThrow(RangeError);
  });
});
