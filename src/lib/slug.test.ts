import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

describe('slugify', () => {
  it.each([
    ['Nước hoa gỗ ấm', 'nuoc-hoa-go-am'],
    ['EDT hay EDP: chọn nồng độ nào?', 'edt-hay-edp-chon-nong-do-nao'],
    ['Đà Lạt  — mùa thu', 'da-lat-mua-thu'],
    ['  --  ', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
