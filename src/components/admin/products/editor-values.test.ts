import { describe, expect, it } from 'vitest';

import type { ProductForEdit } from '@/server/modules/catalog';

import { tabForPath, toEditorValues, toSavePayload } from './editor-values';

const data = {
  product: {
    id: 'p1',
    brandId: 'b1',
    productLineId: null,
    gender: 'male',
    concentration: 'edt',
    releaseYear: 2020,
    perfumer: null,
    longevity: 3,
    sillage: null,
    seasons: ['spring'],
    occasions: [],
    isFeatured: false,
    countryOfOrigin: 'Pháp',
    cosmeticNotificationNo: null,
    responsibleImporter: null,
    ingredients: null,
    warnings: null,
    updatedAt: new Date('2026-11-11T10:00:00.123Z'),
  },
  translations: {
    vi: {
      name: 'Gỗ',
      slug: 'go',
      subtitle: null,
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mô tả' }] }],
      },
      seoTitle: null,
      seoDescription: null,
      isPublished: true,
    },
    en: null,
  },
  variants: [
    {
      id: 'v1',
      sku: 'A-100',
      barcode: null,
      sizeMl: 100,
      variantType: 'full_size',
      price: 3_200_000,
      compareAtPrice: null,
      costPrice: 2_000_000,
      weightG: 450,
      isDefault: true,
      isActive: true,
      onHand: 4,
      reserved: 0,
    },
  ],
  categoryIds: ['c1'],
  notes: { top: ['n1'], middle: [], base: [] },
  families: [{ familyId: 'f1', isPrimary: true }],
  media: [
    {
      id: 'm1',
      storageKey: 'media/x.webp',
      url: '/api/media/media/x.webp',
      width: 10,
      height: 10,
      mime: 'image/webp',
      sizeBytes: 1,
      blurDataUrl: null,
      alt: { vi: 'Chai', en: null },
      variantId: 'v1',
    },
  ],
} as unknown as ProductForEdit;

describe('product editor values', () => {
  it('round-trips into a save payload without changing prices', () => {
    const values = toEditorValues(data);
    expect(values.translations.vi.description).toEqual(data.translations.vi?.description);
    expect(values.media[0]?.variantIndex).toBe(0);
    const payload = toSavePayload('p1', values);
    expect(payload.expectedUpdatedAt).toBe('2026-11-11T10:00:00.123Z');
    expect(payload.variants).toEqual([
      {
        id: 'v1',
        sku: 'A-100',
        barcode: null,
        sizeMl: 100,
        variantType: 'full_size',
        price: 3_200_000,
        compareAtPrice: null,
        costPrice: 2_000_000,
        weightG: 450,
        isDefault: true,
        isActive: true,
      },
    ]);
    expect(payload.translations.vi?.description).toEqual(data.translations.vi!.description);
    expect(payload.media).toEqual([
      { mediaId: 'm1', variantIndex: 0, alt: { vi: 'Chai', en: null } },
    ]);
  });

  it('maps error paths to editor tabs', () => {
    expect(tabForPath('variants.0.price')).toBe('variants');
    expect(tabForPath('translations.en.seoTitle')).toBe('seo');
    expect(tabForPath('translations.vi.slug')).toBe('details');
    expect(tabForPath('media.1.alt.vi')).toBe('media');
    expect(tabForPath('compliance.ingredients')).toBe('compliance');
  });
});
