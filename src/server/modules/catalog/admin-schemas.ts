import { z } from 'zod';

import { isValidSlug } from '@/lib/slug';

/*
 * Admin (write side) input schemas for the catalogue. Error messages are stable codes that
 * the admin UI translates (`admin.errors.<code>`), never user-facing text.
 *
 * Vietnamese translations are required; English is optional and shows on the storefront
 * only when `isPublished` is true (ADR-0011, ADR-0021).
 */

export const LOCALES = ['vi', 'en'] as const;
export type ContentLocale = (typeof LOCALES)[number];

export const PUBLICATION_STATUSES = ['draft', 'active', 'archived'] as const;
export const GENDERS = ['male', 'female', 'unisex'] as const;
export const CONCENTRATIONS = ['edc', 'edt', 'edp', 'parfum', 'extrait', 'other'] as const;
/** `decant` is deliberately absent: not sold in MVP (ADR-0015). */
export const ADMIN_VARIANT_TYPES = ['full_size', 'travel', 'tester', 'gift_set'] as const;
export const NOTE_LAYERS = ['top', 'middle', 'base'] as const;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export const OCCASIONS = ['day', 'night', 'office', 'casual', 'date', 'special'] as const;

/** Recommended maxima for search snippets (ARCHITECTURE.md §13.1), with some slack. */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 170;

/** Largest VND amount accepted from the admin UI (1 billion đồng). */
export const MAX_PRICE_VND = 1_000_000_000;

const trimmed = (max: number) => z.string().trim().max(max, { error: 'tooLong' });

export const requiredText = (max = 200) =>
  z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .max(max, { error: 'tooLong' });

/** Optional text: blank strings become `null`. */
export const optionalText = (max = 2000) =>
  trimmed(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const slugSchema = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .refine(isValidSlug, { error: 'slugInvalid' });

export const idSchema = z.uuid({ error: 'invalid' });
const optionalId = z.union([idSchema, z.null(), z.literal('')]).transform((v) => v || null);

/** Rich text document (Tiptap JSON). Sanitized on render; here only shape and size. */
export const richTextDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).max(500) })
  .refine((doc) => JSON.stringify(doc).length <= 100_000, { error: 'tooLong' });

const seoFields = {
  seoTitle: optionalText(SEO_TITLE_MAX),
  seoDescription: optionalText(SEO_DESCRIPTION_MAX),
};

/** `{ vi: T, en: T | null }`: English may be absent (deleted when null). */
export function translationsOf<T extends z.ZodType>(schema: T) {
  return z.object({ vi: schema, en: schema.nullable().default(null) });
}

const vndAmount = z
  .number({ error: 'invalid' })
  .int({ error: 'integer' })
  .min(0, { error: 'tooSmall' })
  .max(MAX_PRICE_VND, { error: 'tooLarge' });

const isoDate = z
  .union([z.iso.datetime({ offset: true }), z.null(), z.literal('')])
  .transform((value) => (value ? new Date(value) : null));

// ---------- Brands ----------

export const brandTranslationSchema = z.object({
  slug: slugSchema,
  story: richTextDocSchema.nullable().default(null),
  ...seoFields,
  isPublished: z.boolean().default(false),
});

export const brandInputSchema = z.object({
  name: requiredText(120),
  country: z
    .union([
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, { error: 'invalid' }),
      z.literal(''),
      z.null(),
    ])
    .transform((value) => value || null),
  logoMediaId: optionalId.default(null),
  isFeatured: z.boolean().default(false),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
  translations: translationsOf(brandTranslationSchema),
});
export type BrandInput = z.output<typeof brandInputSchema>;

// ---------- Product lines ----------

export const productLineInputSchema = z.object({
  brandId: idSchema,
  name: requiredText(120),
});
export type ProductLineInput = z.output<typeof productLineInputSchema>;

// ---------- Categories and collections ----------

export const listingTranslationSchema = z.object({
  name: requiredText(120),
  slug: slugSchema,
  description: optionalText(5000),
  ...seoFields,
  isPublished: z.boolean().default(false),
});

export const categoryInputSchema = z.object({
  parentId: optionalId.default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  translations: translationsOf(listingTranslationSchema),
});
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const collectionInputSchema = z
  .object({
    heroMediaId: optionalId.default(null),
    startsAt: isoDate.default(null),
    endsAt: isoDate.default(null),
    isActive: z.boolean().default(true),
    translations: translationsOf(listingTranslationSchema),
  })
  .refine((c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt, {
    error: 'endBeforeStart',
    path: ['endsAt'],
  });
export type CollectionInput = z.output<typeof collectionInputSchema>;

export const collectionProductsInputSchema = z.object({
  collectionId: idSchema,
  productIds: z
    .array(idSchema)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate' }),
});

// ---------- Scent families and notes ----------

export const taxonomyTranslationSchema = z.object({
  name: requiredText(120),
  slug: slugSchema,
  description: optionalText(5000),
});

export const taxonomyInputSchema = z.object({
  imageMediaId: optionalId.default(null),
  translations: translationsOf(taxonomyTranslationSchema),
});
export type TaxonomyInput = z.output<typeof taxonomyInputSchema>;

// ---------- Products ----------

export const productTranslationSchema = z.object({
  name: requiredText(200),
  slug: slugSchema,
  subtitle: optionalText(200),
  description: richTextDocSchema.nullable().default(null),
  ...seoFields,
  isPublished: z.boolean().default(false),
});
export type ProductTranslationInput = z.output<typeof productTranslationSchema>;

export const productCreateSchema = z.object({
  brandId: idSchema,
  productLineId: optionalId.default(null),
  gender: z.enum(GENDERS, { error: 'required' }),
  concentration: z.enum(CONCENTRATIONS, { error: 'required' }),
  translations: z.object({ vi: z.object({ name: requiredText(200), slug: slugSchema }) }),
});
export type ProductCreateInput = z.output<typeof productCreateSchema>;

const rating = z.union([z.number().int().min(1).max(5), z.null()]).default(null);

export const productDetailsSchema = z.object({
  brandId: idSchema,
  productLineId: optionalId.default(null),
  gender: z.enum(GENDERS),
  concentration: z.enum(CONCENTRATIONS),
  releaseYear: z
    .union([
      z.number().int().min(1700, { error: 'tooSmall' }).max(2100, { error: 'tooLarge' }),
      z.null(),
    ])
    .default(null),
  perfumer: optionalText(200),
  longevity: rating,
  sillage: rating,
  seasons: z.array(z.enum(SEASONS)).max(SEASONS.length).default([]),
  occasions: z.array(z.enum(OCCASIONS)).max(OCCASIONS.length).default([]),
  isFeatured: z.boolean().default(false),
  categoryIds: z.array(idSchema).max(20).default([]),
});

export const variantInputSchema = z
  .object({
    /** Absent for a new variant. */
    id: idSchema.optional(),
    sku: z
      .string({ error: 'required' })
      .trim()
      .toUpperCase()
      .min(1, { error: 'required' })
      .max(64, { error: 'tooLong' })
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/, { error: 'skuInvalid' }),
    barcode: z
      .union([
        z
          .string()
          .trim()
          .regex(/^\d{8,14}$/, { error: 'barcodeInvalid' }),
        z.literal(''),
        z.null(),
      ])
      .transform((value) => value || null)
      .default(null),
    sizeMl: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(1, { error: 'tooSmall' })
      .max(5000),
    variantType: z.enum(ADMIN_VARIANT_TYPES, { error: 'invalid' }),
    price: vndAmount,
    compareAtPrice: vndAmount.nullable().default(null),
    costPrice: vndAmount.nullable().default(null),
    weightG: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(1, { error: 'tooSmall' })
      .max(50_000),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.compareAtPrice === null || v.compareAtPrice > v.price, {
    error: 'compareAtNotHigher',
    path: ['compareAtPrice'],
  });
export type VariantInput = z.output<typeof variantInputSchema>;

export const scentInputSchema = z.object({
  notes: z.object({
    top: z.array(idSchema).max(30).default([]),
    middle: z.array(idSchema).max(30).default([]),
    base: z.array(idSchema).max(30).default([]),
  }),
  families: z
    .array(z.object({ familyId: idSchema, isPrimary: z.boolean() }))
    .max(10)
    .default([])
    .refine((list) => list.length === 0 || list.filter((f) => f.isPrimary).length === 1, {
      error: 'onePrimaryFamily',
    })
    .refine((list) => new Set(list.map((f) => f.familyId)).size === list.length, {
      error: 'duplicate',
    }),
});

export const productMediaInputSchema = z.object({
  mediaId: idSchema,
  /** Index into `variants` (new variants have no id yet), or null for the whole product. */
  variantIndex: z.number().int().min(0).nullable().default(null),
  alt: z.object({ vi: requiredText(200), en: optionalText(200) }),
});

export const complianceInputSchema = z.object({
  countryOfOrigin: optionalText(100),
  cosmeticNotificationNo: optionalText(100),
  responsibleImporter: optionalText(300),
  ingredients: optionalText(10_000),
  warnings: optionalText(5_000),
});

export const productSaveSchema = z
  .object({
    id: idSchema,
    /** Optimistic lock: the `updatedAt` the editor loaded (ISO string). */
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    details: productDetailsSchema,
    translations: translationsOf(productTranslationSchema),
    variants: z.array(variantInputSchema).max(30),
    scent: scentInputSchema,
    media: z.array(productMediaInputSchema).max(30),
    compliance: complianceInputSchema,
  })
  .superRefine((input, ctx) => {
    const skus = new Map<string, number>();
    input.variants.forEach((variant, index) => {
      const previous = skus.get(variant.sku);
      if (previous !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'duplicate', path: ['variants', index, 'sku'] });
      }
      skus.set(variant.sku, index);
    });
    const defaults = input.variants.filter((v) => v.isDefault).length;
    if (input.variants.length > 0 && defaults !== 1) {
      ctx.addIssue({ code: 'custom', message: 'oneDefaultVariant', path: ['variants'] });
    }
    input.media.forEach((item, index) => {
      if (item.variantIndex !== null && item.variantIndex >= input.variants.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'invalid',
          path: ['media', index, 'variantIndex'],
        });
      }
    });
    const mediaIds = input.media.map((m) => m.mediaId);
    if (new Set(mediaIds).size !== mediaIds.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate', path: ['media'] });
    }
  });
export type ProductSaveInput = z.output<typeof productSaveSchema>;

export const productStatusSchema = z.object({
  id: idSchema,
  status: z.enum(PUBLICATION_STATUSES),
});

export const idInputSchema = z.object({ id: idSchema });

// ---------- Admin list queries (URL search params) ----------

export const ADMIN_PAGE_SIZES = [20, 50, 100] as const;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .refine((n) => (ADMIN_PAGE_SIZES as readonly number[]).includes(n))
    .default(20),
  sort: z.string().max(40).default(''),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListQuery = z.output<typeof listQuerySchema>;
