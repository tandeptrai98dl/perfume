import { describe, expect, it } from 'vitest';

import { catalogRouteData, catalogSitemapEntries, type CatalogRouteEntity } from './routes';

const product = (overrides: Partial<CatalogRouteEntity> = {}): CatalogRouteEntity => ({
  kind: 'product',
  id: 'p1',
  slugs: { vi: { slug: 'cedre-nocturne-edp', published: true } },
  visibleFrom: null,
  lastModified: new Date('2026-11-01T00:00:00Z'),
  ...overrides,
});

describe('catalogRouteData', () => {
  it('lists published paths and sends the other locale to the listing when untranslated', () => {
    const data = catalogRouteData([product()]);
    expect(data.contentPaths).toEqual([
      { path: '/san-pham/cedre-nocturne-edp', visibleFrom: null },
    ]);
    expect(data.localeFallbacks).toEqual([
      { path: '/en/products/cedre-nocturne-edp', toPath: '/en/perfumes' },
    ]);
  });

  it('maps a kept slug to the translated page', () => {
    const data = catalogRouteData([
      {
        ...product(),
        kind: 'brand',
        slugs: {
          vi: { slug: 'maison-lumiere', published: true },
          en: { slug: 'maison-lumiere-en', published: true },
        },
      },
    ]);
    expect(data.contentPaths.map((p) => p.path).sort()).toEqual([
      '/en/brands/maison-lumiere-en',
      '/thuong-hieu/maison-lumiere',
    ]);
    expect(data.localeFallbacks).toContainEqual({
      path: '/en/brands/maison-lumiere',
      toPath: '/en/brands/maison-lumiere-en',
    });
  });

  it('never exposes unpublished translations', () => {
    const data = catalogRouteData([product({ slugs: { vi: { slug: 'nhap', published: false } } })]);
    expect(data.contentPaths).toEqual([]);
    expect(data.localeFallbacks).toEqual([]);
  });
});

describe('catalogSitemapEntries', () => {
  it('keeps only published locales and skips scheduled entities', () => {
    const now = Date.parse('2026-11-11T00:00:00Z');
    const entries = catalogSitemapEntries(
      [
        product(),
        product({
          id: 'p2',
          visibleFrom: now + 60_000,
          slugs: { vi: { slug: 'sap-ra-mat', published: true } },
        }),
      ],
      'product',
      now,
    );
    expect(entries).toEqual([
      {
        alternates: { vi: '/san-pham/cedre-nocturne-edp' },
        lastModified: new Date('2026-11-01T00:00:00Z'),
      },
    ]);
  });
});
