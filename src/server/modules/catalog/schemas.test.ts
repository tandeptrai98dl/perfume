import { describe, expect, it } from 'vitest';

import { countActiveFilters, listingFiltersSchema, listingQuerySchema } from './schemas';

describe('listingQuerySchema', () => {
  it('applies defaults', () => {
    const query = listingQuerySchema.parse({ locale: 'vi' });
    expect(query).toMatchObject({
      scope: { kind: 'all' },
      q: '',
      sort: 'featured',
      page: 1,
      pageSize: 24,
    });
    expect(query.filters.brands).toEqual([]);
  });

  it('drops invalid filter values instead of failing', () => {
    const filters = listingFiltersSchema.parse({
      brands: ['maison-lumiere', 'Bad Slug!', 'maison-lumiere'],
      genders: ['male', 'robot'],
      types: ['travel', 'decant'],
      concentrations: ['edp', 'xyz'],
      minPrice: -5,
      inStock: 'yes',
    });
    expect(filters.brands).toEqual(['maison-lumiere']);
    expect(filters.genders).toEqual(['male']);
    // Decants are never filterable (ADR-0015).
    expect(filters.types).toEqual(['travel']);
    expect(filters.concentrations).toEqual(['edp']);
    expect(filters.minPrice).toBeNull();
    expect(filters.inStock).toBe(false);
  });

  it('sorts values so equivalent URLs share one cache key', () => {
    expect(listingFiltersSchema.parse({ brands: ['b', 'a'] }).brands).toEqual(['a', 'b']);
  });

  it('swaps a reversed price range', () => {
    const filters = listingFiltersSchema.parse({ minPrice: 4_000_000, maxPrice: 2_000_000 });
    expect([filters.minPrice, filters.maxPrice]).toEqual([2_000_000, 4_000_000]);
  });

  it('falls back on invalid sort and page', () => {
    const query = listingQuerySchema.parse({ locale: 'en', sort: 'cheapest', page: 9999 });
    expect(query.sort).toBe('featured');
    expect(query.page).toBe(1);
  });

  it('rejects unknown locales', () => {
    expect(() => listingQuerySchema.parse({ locale: 'fr' })).toThrow();
  });
});

describe('countActiveFilters', () => {
  it('counts every value plus price and stock toggles', () => {
    const filters = listingFiltersSchema.parse({
      brands: ['a', 'b'],
      genders: ['female'],
      maxPrice: 2_000_000,
      inStock: true,
    });
    expect(countActiveFilters(filters)).toBe(5);
    expect(countActiveFilters(listingFiltersSchema.parse({}))).toBe(0);
  });
});
