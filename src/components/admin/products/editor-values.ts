import { docToPlainText } from '@/lib/plain-text-doc';
import type { RichTextDoc } from '@/lib/rich-text';
import type { ProductForEdit, ProductSaveInput } from '@/server/modules/catalog';

/**
 * ProductEditor form state ⇄ `productSaveSchema` payload. Kept pure so it can be unit
 * tested; the only UI-specific differences are the plain-text description (until the
 * RichTextEditor lands) and media display data.
 */

export type EditorTranslation = {
  name: string;
  slug: string;
  subtitle: string | null;
  /** Plain text; converted to a rich-text document on save. */
  description: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
};

export type EditorVariant = {
  id?: string;
  sku: string;
  barcode: string | null;
  sizeMl: number | null;
  variantType: 'full_size' | 'travel' | 'tester' | 'gift_set';
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  weightG: number | null;
  isDefault: boolean;
  isActive: boolean;
  /** Read-only display. */
  onHand?: number;
};

export type EditorMedia = {
  mediaId: string;
  url: string;
  width: number | null;
  height: number | null;
  variantIndex: number | null;
  alt: { vi: string; en: string | null };
};

export type ProductEditorValues = {
  expectedUpdatedAt: string;
  details: {
    brandId: string;
    productLineId: string | null;
    gender: 'male' | 'female' | 'unisex';
    concentration: 'edc' | 'edt' | 'edp' | 'parfum' | 'extrait' | 'other';
    releaseYear: number | null;
    perfumer: string | null;
    longevity: number | null;
    sillage: number | null;
    seasons: string[];
    occasions: string[];
    isFeatured: boolean;
    categoryIds: string[];
  };
  translations: { vi: EditorTranslation; en: EditorTranslation | null };
  variants: EditorVariant[];
  scent: {
    notes: { top: string[]; middle: string[]; base: string[] };
    families: { familyId: string; isPrimary: boolean }[];
  };
  media: EditorMedia[];
  compliance: {
    countryOfOrigin: string | null;
    cosmeticNotificationNo: string | null;
    responsibleImporter: string | null;
    ingredients: string | null;
    warnings: string | null;
  };
};

export const emptyEditorTranslation = (): EditorTranslation => ({
  name: '',
  slug: '',
  subtitle: null,
  description: null,
  seoTitle: null,
  seoDescription: null,
  isPublished: false,
});

function toEditorTranslation(
  value: ProductForEdit['translations']['vi'],
): EditorTranslation | null {
  if (!value) return null;
  return {
    name: value.name,
    slug: value.slug,
    subtitle: value.subtitle,
    description: (value.description as RichTextDoc | null) ?? null,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    isPublished: value.isPublished,
  };
}

const ADMIN_TYPES = new Set(['full_size', 'travel', 'tester', 'gift_set']);

export function toEditorValues(data: ProductForEdit): ProductEditorValues {
  const { product } = data;
  const variantIndex = new Map(data.variants.map((v, index) => [v.id, index]));
  return {
    expectedUpdatedAt: new Date(product.updatedAt).toISOString(),
    details: {
      brandId: product.brandId,
      productLineId: product.productLineId,
      gender: product.gender,
      concentration: product.concentration,
      releaseYear: product.releaseYear,
      perfumer: product.perfumer,
      longevity: product.longevity,
      sillage: product.sillage,
      seasons: product.seasons,
      occasions: product.occasions,
      isFeatured: product.isFeatured,
      categoryIds: data.categoryIds,
    },
    translations: {
      vi: toEditorTranslation(data.translations.vi) ?? emptyEditorTranslation(),
      en: toEditorTranslation(data.translations.en),
    },
    variants: data.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      sizeMl: v.sizeMl,
      // Decants never reach the admin UI (ADR-0015); none exist in MVP data.
      variantType: (ADMIN_TYPES.has(v.variantType)
        ? v.variantType
        : 'full_size') as EditorVariant['variantType'],
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      costPrice: v.costPrice,
      weightG: v.weightG,
      isDefault: v.isDefault,
      isActive: v.isActive,
      onHand: v.onHand,
    })),
    scent: { notes: data.notes, families: data.families },
    media: data.media.map((m) => ({
      mediaId: m.id,
      url: m.url,
      width: m.width,
      height: m.height,
      variantIndex: m.variantId ? (variantIndex.get(m.variantId) ?? null) : null,
      alt: { vi: m.alt.vi ?? '', en: m.alt.en },
    })),
    compliance: {
      countryOfOrigin: product.countryOfOrigin,
      cosmeticNotificationNo: product.cosmeticNotificationNo,
      responsibleImporter: product.responsibleImporter,
      ingredients: product.ingredients,
      warnings: product.warnings,
    },
  };
}

/** Raw payload for `saveProductAction` (validated again by Zod on the server). */
export function toSavePayload(id: string, values: ProductEditorValues) {
  const translation = (value: EditorTranslation | null) =>
    value && {
      ...value,
      // An editor emptied by the user is stored as "no description".
      description: docToPlainText(value.description) ? value.description : null,
    };
  return {
    id,
    expectedUpdatedAt: values.expectedUpdatedAt,
    details: values.details,
    translations: {
      vi: translation(values.translations.vi),
      en: translation(values.translations.en),
    },
    variants: values.variants.map((variant) => {
      const copy = { ...variant };
      delete copy.onHand;
      return copy;
    }),
    scent: values.scent,
    media: values.media.map((m) => ({
      mediaId: m.mediaId,
      variantIndex: m.variantIndex,
      alt: m.alt,
    })),
    compliance: values.compliance,
  } satisfies Record<keyof ProductSaveInput, unknown>;
}

/** Which editor tab holds a field path (to reveal server errors). */
export function tabForPath(path: string): EditorTab {
  if (path.startsWith('variants')) return 'variants';
  if (path.startsWith('scent')) return 'scent';
  if (path.startsWith('media')) return 'media';
  if (path.startsWith('compliance')) return 'compliance';
  if (/^translations\.(vi|en)\.seo/.test(path)) return 'seo';
  return 'details';
}

export const EDITOR_TABS = ['details', 'variants', 'scent', 'media', 'seo', 'compliance'] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];
