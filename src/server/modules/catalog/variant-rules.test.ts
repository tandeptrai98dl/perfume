import { describe, expect, it } from 'vitest';

import { priceFieldViolations, variantSetIssues, type VariantPrices } from './variant-rules';

const existing = new Map<string, VariantPrices>([
  ['v1', { price: 1_000_000, compareAtPrice: null, costPrice: 600_000 }],
]);

describe('priceFieldViolations', () => {
  it('allows everything with products.editPrices', () => {
    expect(
      priceFieldViolations(existing, [{ price: 5, compareAtPrice: 6, costPrice: null }], true),
    ).toEqual([]);
  });

  it('accepts unchanged prices without the permission', () => {
    expect(
      priceFieldViolations(
        existing,
        [{ id: 'v1', price: 1_000_000, compareAtPrice: null, costPrice: 600_000 }],
        false,
      ),
    ).toEqual([]);
  });

  it('rejects changed price fields without the permission', () => {
    expect(
      priceFieldViolations(
        existing,
        [{ id: 'v1', price: 900_000, compareAtPrice: 1_200_000, costPrice: 600_000 }],
        false,
      ),
    ).toEqual([
      { path: 'variants.0.price', code: 'forbiddenField' },
      { path: 'variants.0.compareAtPrice', code: 'forbiddenField' },
    ]);
  });

  it('rejects new variants without the permission', () => {
    expect(
      priceFieldViolations(existing, [{ price: 0, compareAtPrice: null, costPrice: null }], false),
    ).toEqual([{ path: 'variants.0', code: 'forbiddenField' }]);
  });
});

describe('variantSetIssues', () => {
  it('requires every saved variant and only known ids', () => {
    expect(variantSetIssues(new Set(['v1']), [{ id: 'v1' }, {}])).toEqual([]);
    expect(variantSetIssues(new Set(['v1']), [{}])).toEqual([
      { path: 'variants', code: 'variantsMissing' },
    ]);
    expect(variantSetIssues(new Set(['v1']), [{ id: 'v1' }, { id: 'other' }])).toEqual([
      { path: 'variants.1', code: 'invalid' },
    ]);
  });
});
