import { describe, expect, it } from 'vitest';

import { normalizeSearchQuery, toPrefixTsQuery } from './search-terms';

describe('normalizeSearchQuery', () => {
  it('strips generic words in Vietnamese with or without accents', () => {
    expect(normalizeSearchQuery('Nước hoa gỗ')).toEqual({ terms: ['go'], genders: [] });
    expect(normalizeSearchQuery('nuoc hoa go')).toEqual({ terms: ['go'], genders: [] });
    expect(normalizeSearchQuery('nước hoa Dior Sauvage chính hãng').terms).toEqual([
      'dior',
      'sauvage',
    ]);
  });

  it('strips generic English words', () => {
    expect(normalizeSearchQuery('woody perfume').terms).toEqual(['woody']);
    expect(normalizeSearchQuery('The best fragrances').terms).toEqual(['best']);
  });

  it('keeps brand + product terms in order and removes duplicates', () => {
    expect(normalizeSearchQuery('Dior  SAUVAGE dior').terms).toEqual(['dior', 'sauvage']);
  });

  it('turns gender words into a gender filter', () => {
    expect(normalizeSearchQuery('nước hoa nam')).toEqual({ terms: [], genders: ['male'] });
    expect(normalizeSearchQuery('perfume for women rose')).toEqual({
      terms: ['rose'],
      genders: ['female'],
    });
  });

  it('maps concentration phrases to the indexed abbreviation', () => {
    expect(normalizeSearchQuery('Sauvage Eau de Parfum').terms).toEqual(['sauvage', 'edp']);
    expect(normalizeSearchQuery('eau de toilette').terms).toEqual(['edt']);
  });

  it('removes punctuation and tsquery syntax', () => {
    expect(normalizeSearchQuery("l'eau d'issey & | ! :*").terms).toEqual([
      'l',
      'eau',
      'd',
      'issey',
    ]);
    expect(normalizeSearchQuery('   ').terms).toEqual([]);
  });

  it('caps the number of terms', () => {
    expect(normalizeSearchQuery('a b c d e f g h i j').terms).toHaveLength(8);
  });
});

describe('toPrefixTsQuery', () => {
  it('ANDs terms and prefix-matches the last one when long enough', () => {
    expect(toPrefixTsQuery(['dior', 'sauv'])).toBe('dior & sauv:*');
    expect(toPrefixTsQuery(['nuoc', 'go'])).toBe('nuoc & go');
    expect(toPrefixTsQuery([])).toBeNull();
  });
});
