import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  localeEnum,
  money,
  primaryId,
  publicationStatusEnum,
  timestamps,
  tsvector,
} from './_shared';

/*
 * Catalogue (ARCHITECTURE.md §6.2). Translatable text lives in *_translations tables keyed by
 * (entity_id, locale); Vietnamese is required to publish, English shows only when
 * is_published = true (ADR-0011, ADR-0021).
 */

// ---------- Media ----------

export const media = pgTable('media', {
  id: primaryId(),
  storageKey: text().notNull().unique(),
  url: text().notNull(),
  width: integer(),
  height: integer(),
  mime: text().notNull(),
  sizeBytes: integer().notNull(),
  blurDataUrl: text(),
  ...timestamps(),
});

export const mediaTranslations = pgTable(
  'media_translations',
  {
    mediaId: uuid()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    alt: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.locale] })],
);

// ---------- Brands ----------

export const brands = pgTable('brands', {
  id: primaryId(),
  /** Brand names are not translated. */
  name: text().notNull(),
  /** ISO 3166-1 alpha-2 country code of the brand. */
  country: text(),
  logoMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
  isFeatured: boolean().notNull().default(false),
  status: publicationStatusEnum().notNull().default('draft'),
  deletedAt: timestamp({ withTimezone: true }),
  ...timestamps(),
});

export const brandTranslations = pgTable(
  'brand_translations',
  {
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    slug: text().notNull(),
    story: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.locale] }), unique().on(t.locale, t.slug)],
);

// ---------- Categories ----------

export const categories = pgTable(
  'categories',
  {
    id: primaryId(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    sortOrder: integer().notNull().default(0),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.parentId)],
);

export const categoryTranslations = pgTable(
  'category_translations',
  {
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.locale] }), unique().on(t.locale, t.slug)],
);

// ---------- Scent families and notes ----------

export const fragranceFamilies = pgTable('fragrance_families', {
  id: primaryId(),
  imageMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
  ...timestamps(),
});

export const fragranceFamilyTranslations = pgTable(
  'fragrance_family_translations',
  {
    familyId: uuid()
      .notNull()
      .references(() => fragranceFamilies.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.locale] }), unique().on(t.locale, t.slug)],
);

export const fragranceNotes = pgTable('fragrance_notes', {
  id: primaryId(),
  imageMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
  ...timestamps(),
});

export const fragranceNoteTranslations = pgTable(
  'fragrance_note_translations',
  {
    noteId: uuid()
      .notNull()
      .references(() => fragranceNotes.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.locale] }), unique().on(t.locale, t.slug)],
);

// ---------- Products ----------

export const genderTargetEnum = pgEnum('gender_target', ['male', 'female', 'unisex']);
export const concentrationEnum = pgEnum('concentration', [
  'edc',
  'edt',
  'edp',
  'parfum',
  'extrait',
  'other',
]);
/** `decant` exists for later use; not sold in MVP (ADR-0015). */
export const variantTypeEnum = pgEnum('variant_type', [
  'full_size',
  'decant',
  'travel',
  'tester',
  'gift_set',
]);
export const noteLayerEnum = pgEnum('note_layer', ['top', 'middle', 'base']);

/** Groups the concentrations of one scent, e.g. "Bleu" EDT / EDP / Parfum (ADR-0004). */
export const productLines = pgTable(
  'product_lines',
  {
    id: primaryId(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [index().on(t.brandId)],
);

export const products = pgTable(
  'products',
  {
    id: primaryId(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    productLineId: uuid().references(() => productLines.id, { onDelete: 'set null' }),
    gender: genderTargetEnum().notNull(),
    concentration: concentrationEnum().notNull(),
    releaseYear: smallint(),
    perfumer: text(),
    longevity: smallint(),
    sillage: smallint(),
    seasons: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    occasions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: publicationStatusEnum().notNull().default('draft'),
    isFeatured: boolean().notNull().default(false),
    publishedAt: timestamp({ withTimezone: true }),
    ratingAvg: numeric({ precision: 2, scale: 1, mode: 'number' }).notNull().default(0),
    ratingCount: integer().notNull().default(0),
    // Cosmetics compliance (ARCHITECTURE.md §1.5).
    countryOfOrigin: text(),
    cosmeticNotificationNo: text(),
    responsibleImporter: text(),
    ingredients: text(),
    warnings: text(),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index().on(t.brandId),
    index().on(t.productLineId),
    index().on(t.status, t.publishedAt),
    check(
      'products_longevity_check',
      sql`${t.longevity} IS NULL OR ${t.longevity} BETWEEN 1 AND 5`,
    ),
    check('products_sillage_check', sql`${t.sillage} IS NULL OR ${t.sillage} BETWEEN 1 AND 5`),
  ],
);

export const productTranslations = pgTable(
  'product_translations',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    subtitle: text(),
    description: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    /** Maintained by trigger `product_translations_search_vector` (migration 0002). */
    searchVector: tsvector(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    unique().on(t.locale, t.slug),
    index('product_translations_search_idx').using('gin', t.searchVector),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text().notNull().unique(),
    barcode: text(),
    sizeMl: integer().notNull(),
    variantType: variantTypeEnum().notNull().default('full_size'),
    price: money().notNull(),
    compareAtPrice: money(),
    costPrice: money(),
    weightG: integer().notNull(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index().on(t.productId, t.isActive),
    index().on(t.price),
    check('product_variants_price_check', sql`${t.price} >= 0`),
    check(
      'product_variants_compare_at_check',
      sql`${t.compareAtPrice} IS NULL OR ${t.compareAtPrice} > ${t.price}`,
    ),
    check('product_variants_size_check', sql`${t.sizeMl} > 0`),
  ],
);

export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] }), index().on(t.categoryId)],
);

export const productFamilies = pgTable(
  'product_families',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    familyId: uuid()
      .notNull()
      .references(() => fragranceFamilies.id, { onDelete: 'cascade' }),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.productId, t.familyId] }), index().on(t.familyId)],
);

export const productNotes = pgTable(
  'product_notes',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    noteId: uuid()
      .notNull()
      .references(() => fragranceNotes.id, { onDelete: 'cascade' }),
    layer: noteLayerEnum().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.noteId, t.layer] }), index().on(t.noteId)],
);

export const productMedia = pgTable(
  'product_media',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    mediaId: uuid()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => productVariants.id, { onDelete: 'set null' }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.mediaId] })],
);

// ---------- Collections ----------

export const collectionKindEnum = pgEnum('collection_kind', ['manual', 'rule']);

export const collections = pgTable('collections', {
  id: primaryId(),
  kind: collectionKindEnum().notNull().default('manual'),
  rules: jsonb(),
  heroMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
  startsAt: timestamp({ withTimezone: true }),
  endsAt: timestamp({ withTimezone: true }),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
});

export const collectionTranslations = pgTable(
  'collection_translations',
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.locale] }), unique().on(t.locale, t.slug)],
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] })],
);
