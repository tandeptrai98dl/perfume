import { describe, expect, it } from 'vitest';

import { isValidSlug, slugify, SLUG_MAX_LENGTH, toSlug, uniqueSlug } from './slug';

describe('toSlug', () => {
  it('folds Vietnamese diacritics and đ', () => {
    expect(toSlug('Nước hoa nữ')).toBe('nuoc-hoa-nu');
    expect(toSlug('Đà Nẵng')).toBe('da-nang');
    expect(toSlug('Hương gỗ & hổ phách')).toBe('huong-go-ho-phach');
  });

  it('folds Latin accents and collapses separators', () => {
    expect(toSlug('  Maison Lumière — Cèdre  Nocturne EDP ')).toBe(
      'maison-lumiere-cedre-nocturne-edp',
    );
    expect(toSlug("Men's fragrances")).toBe('men-s-fragrances');
  });

  it('returns an empty string when nothing is left', () => {
    expect(toSlug('!!!')).toBe('');
  });

  it('caps the length without a trailing hyphen', () => {
    const slug = toSlug(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase hyphenated words only', () => {
    expect(isValidSlug('nuoc-hoa-nu')).toBe(true);
    expect(isValidSlug('Nuoc-hoa')).toBe(false);
    expect(isValidSlug('nuoc--hoa')).toBe(false);
    expect(isValidSlug('-nuoc')).toBe(false);
    expect(isValidSlug('nước')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('appends the first free numeric suffix', () => {
    expect(uniqueSlug('rose', new Set())).toBe('rose');
    expect(uniqueSlug('rose', new Set(['rose']))).toBe('rose-2');
    expect(uniqueSlug('rose', new Set(['rose', 'rose-2']))).toBe('rose-3');
  });
});

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
