import { describe, expect, it } from 'vitest';

import { listingQueryString, loadListingParams, toListingFilters } from './listing-params';

describe('listing URL params', () => {
  it('parses comma-separated filters, numbers and booleans', () => {
    const params = loadListingParams({
      brand: 'maison-lumiere,ambre-studio',
      gender: 'male',
      minPrice: '2000000',
      inStock: 'true',
      sort: 'price_asc',
      page: '2',
    });
    expect(params.brand).toEqual(['maison-lumiere', 'ambre-studio']);
    expect(params.minPrice).toBe(2_000_000);
    expect(params.inStock).toBe(true);
    expect(params.sort).toBe('price_asc');
    expect(params.page).toBe(2);
    expect(toListingFilters(params)).toMatchObject({
      brands: ['maison-lumiere', 'ambre-studio'],
      genders: ['male'],
      minPrice: 2_000_000,
      maxPrice: null,
      inStock: true,
    });
  });

  it('ignores unknown sort values', () => {
    expect(loadListingParams({ sort: 'cheap' }).sort).toBeNull();
  });

  it('serializes without defaults and resets the page on demand', () => {
    const params = loadListingParams({ brand: 'a', page: '3' });
    expect(listingQueryString(params)).toBe('?brand=a&page=3');
    expect(listingQueryString(params, { page: null })).toBe('?brand=a');
    expect(listingQueryString(params, { brand: [], page: 1 })).toBe('');
  });
});
