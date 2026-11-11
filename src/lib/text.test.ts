import { describe, expect, it } from 'vitest';

import { foldVietnamese, matchesFolded } from './text';

describe('foldVietnamese', () => {
  it('removes tones and maps đ', () => {
    expect(foldVietnamese('Thành phố Hồ Chí Minh')).toBe('thanh pho ho chi minh');
    expect(foldVietnamese('Đà Nẵng')).toBe('da nang');
    expect(foldVietnamese('Thừa Thiên Huế')).toBe('thua thien hue');
  });

  it('matches every term regardless of accents and order', () => {
    expect(matchesFolded('Phường Bến Nghé', 'ben nghe')).toBe(true);
    expect(matchesFolded('Phường Bến Nghé', 'nghe phuong')).toBe(true);
    expect(matchesFolded('Phường Bến Nghé', 'thanh')).toBe(false);
    expect(matchesFolded('Hà Nội', '')).toBe(true);
  });
});
