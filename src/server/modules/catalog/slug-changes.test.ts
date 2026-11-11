import { describe, expect, it } from 'vitest';

import { detectSlugChanges, storefrontPath } from './slug-changes';

describe('storefrontPath', () => {
  it('uses Vietnamese pathnames without prefix and English under /en', () => {
    expect(storefrontPath('product', 'vi', 'a')).toBe('/san-pham/a');
    expect(storefrontPath('product', 'en', 'a')).toBe('/en/products/a');
    expect(storefrontPath('brand', 'vi', 'b')).toBe('/thuong-hieu/b');
    expect(storefrontPath('family', 'en', 'woody')).toBe('/en/scent-families/woody');
  });
});

describe('detectSlugChanges', () => {
  it('reports a changed slug of a published translation', () => {
    expect(
      detectSlugChanges(
        'product',
        'p1',
        { vi: { slug: 'old', isPublished: true }, en: { slug: 'same', isPublished: true } },
        { vi: { slug: 'new', isPublished: true }, en: { slug: 'same', isPublished: true } },
      ),
    ).toEqual([
      {
        entityType: 'product',
        entityId: 'p1',
        locale: 'vi',
        fromSlug: 'old',
        toSlug: 'new',
        fromPath: '/san-pham/old',
        toPath: '/san-pham/new',
      },
    ]);
  });

  it('ignores unpublished, new and removed translations', () => {
    expect(
      detectSlugChanges(
        'category',
        'c1',
        { vi: { slug: 'a', isPublished: false }, en: { slug: 'x', isPublished: true } },
        { vi: { slug: 'b', isPublished: true }, en: null },
      ),
    ).toEqual([]);
    expect(detectSlugChanges('brand', 'b1', {}, { vi: { slug: 'b' } })).toEqual([]);
  });

  it('treats entities without a publish flag as live', () => {
    expect(
      detectSlugChanges('family', 'f1', { en: { slug: 'woods' } }, { en: { slug: 'woody' } }),
    ).toHaveLength(1);
  });
});
