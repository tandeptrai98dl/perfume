import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '@/server/db/client';
import {
  brands,
  brandTranslations,
  categories,
  categoryTranslations,
  collectionProducts,
  collections,
  collectionTranslations,
  fragranceFamilies,
  fragranceFamilyTranslations,
  fragranceNotes,
  fragranceNoteTranslations,
  inventoryItems,
  media,
  mediaTranslations,
  productCategories,
  productFamilies,
  productLines,
  productMedia,
  productNotes,
  products,
  productTranslations,
  productVariants,
} from '@/server/db/schema';
import { foldedContains, pageOffset, type Paged } from '@/server/lib/sql-helpers';

import type { ListQuery } from './admin-schemas';

/*
 * Admin read side of the catalogue: list screens (server-side search/sort/pagination) and the
 * editor payloads. Lists show Vietnamese names plus the English translation status.
 */

type Reader = Pick<Database, 'select' | 'selectDistinct'>;

export type TranslationStatus = 'missing' | 'draft' | 'published';

export function translationStatus(
  row: { isPublished?: boolean | null; exists?: boolean } | null | undefined,
): TranslationStatus {
  if (!row || row.exists === false) return 'missing';
  if (row.isPublished === undefined || row.isPublished === null) return 'published';
  return row.isPublished ? 'published' : 'draft';
}

const statusSql = (exists: SQL, published: SQL | null) =>
  published
    ? sql<TranslationStatus>`case when ${exists} then case when ${published} then 'published' else 'draft' end else 'missing' end`
    : sql<TranslationStatus>`case when ${exists} then 'published' else 'missing' end`;

function direction(dir: 'asc' | 'desc') {
  return dir === 'asc' ? asc : desc;
}

async function paged<T>(
  rowsPromise: Promise<T[]>,
  totalPromise: Promise<{ total: number }[]>,
  query: Pick<ListQuery, 'page' | 'pageSize'>,
): Promise<Paged<T>> {
  const [rows, [totalRow]] = await Promise.all([rowsPromise, totalPromise]);
  return { rows, total: totalRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

// ---------- Brands ----------

const brandVi = alias(brandTranslations, 'brand_vi');
const brandEn = alias(brandTranslations, 'brand_en');

export type BrandListRow = {
  id: string;
  name: string;
  country: string | null;
  status: 'draft' | 'active' | 'archived';
  isFeatured: boolean;
  slug: string | null;
  viStatus: TranslationStatus;
  enStatus: TranslationStatus;
  productCount: number;
  updatedAt: Date;
};

export const BRAND_SORTS = ['name', 'updatedAt', 'productCount'] as const;

export async function listBrands(
  db: Reader,
  query: ListQuery & { status?: string | null },
): Promise<Paged<BrandListRow>> {
  const productCount = sql<number>`(select count(*) from ${products} where ${products.brandId} = ${brands.id} and ${products.deletedAt} is null)`;
  const where = and(
    isNull(brands.deletedAt),
    query.q
      ? or(foldedContains(brands.name, query.q), foldedContains(brandVi.slug, query.q))
      : undefined,
    query.status ? eq(brands.status, query.status as BrandListRow['status']) : undefined,
  );
  const order =
    query.sort === 'updatedAt'
      ? direction(query.dir)(brands.updatedAt)
      : query.sort === 'productCount'
        ? direction(query.dir)(productCount)
        : direction(query.sort ? query.dir : 'asc')(brands.name);
  return paged(
    db
      .select({
        id: brands.id,
        name: brands.name,
        country: brands.country,
        status: brands.status,
        isFeatured: brands.isFeatured,
        slug: brandVi.slug,
        viStatus: statusSql(sql`${brandVi.brandId} is not null`, sql`${brandVi.isPublished}`),
        enStatus: statusSql(sql`${brandEn.brandId} is not null`, sql`${brandEn.isPublished}`),
        productCount: productCount.mapWith(Number),
        updatedAt: brands.updatedAt,
      })
      .from(brands)
      .leftJoin(brandVi, and(eq(brandVi.brandId, brands.id), eq(brandVi.locale, 'vi')))
      .leftJoin(brandEn, and(eq(brandEn.brandId, brands.id), eq(brandEn.locale, 'en')))
      .where(where)
      .orderBy(order, asc(brands.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(brands)
      .leftJoin(brandVi, and(eq(brandVi.brandId, brands.id), eq(brandVi.locale, 'vi')))
      .where(where),
    query,
  );
}

type TranslationMap<T> = { vi: T | null; en: T | null };

function byLocale<T extends { locale: 'vi' | 'en' }>(rows: T[]): TranslationMap<Omit<T, 'locale'>> {
  const pick = (locale: 'vi' | 'en') => {
    const row = rows.find((r) => r.locale === locale);
    if (!row) return null;
    const rest: Partial<T> = { ...row };
    delete rest.locale;
    return rest as Omit<T, 'locale'>;
  };
  return { vi: pick('vi'), en: pick('en') };
}

export async function getBrand(db: Reader, id: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, id), isNull(brands.deletedAt)));
  if (!brand) return null;
  const translations = await db
    .select({
      locale: brandTranslations.locale,
      slug: brandTranslations.slug,
      story: brandTranslations.story,
      seoTitle: brandTranslations.seoTitle,
      seoDescription: brandTranslations.seoDescription,
      isPublished: brandTranslations.isPublished,
    })
    .from(brandTranslations)
    .where(eq(brandTranslations.brandId, id));
  const logo = brand.logoMediaId ? await getMediaItems(db, [brand.logoMediaId]) : [];
  return { ...brand, translations: byLocale(translations), logo: logo[0] ?? null };
}
export type BrandDetail = NonNullable<Awaited<ReturnType<typeof getBrand>>>;

export async function brandOptions(db: Reader) {
  return db
    .select({ id: brands.id, name: brands.name, status: brands.status })
    .from(brands)
    .where(isNull(brands.deletedAt))
    .orderBy(asc(brands.name));
}

// ---------- Product lines ----------

export type ProductLineRow = {
  id: string;
  name: string;
  brandId: string;
  brandName: string;
  productCount: number;
};

export async function listProductLines(
  db: Reader,
  query: ListQuery & { brandId?: string | null },
): Promise<Paged<ProductLineRow>> {
  const productCount = sql<number>`(select count(*) from ${products} where ${products.productLineId} = ${productLines.id} and ${products.deletedAt} is null)`;
  const where = and(
    query.q
      ? or(foldedContains(productLines.name, query.q), foldedContains(brands.name, query.q))
      : undefined,
    query.brandId ? eq(productLines.brandId, query.brandId) : undefined,
  );
  const order =
    query.sort === 'brand'
      ? [direction(query.dir)(brands.name), asc(productLines.name)]
      : [direction(query.sort ? query.dir : 'asc')(productLines.name)];
  return paged(
    db
      .select({
        id: productLines.id,
        name: productLines.name,
        brandId: productLines.brandId,
        brandName: brands.name,
        productCount: productCount.mapWith(Number),
      })
      .from(productLines)
      .innerJoin(brands, eq(brands.id, productLines.brandId))
      .where(where)
      .orderBy(...order, asc(productLines.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(productLines)
      .innerJoin(brands, eq(brands.id, productLines.brandId))
      .where(where),
    query,
  );
}

export async function productLineOptions(db: Reader) {
  return db
    .select({ id: productLines.id, name: productLines.name, brandId: productLines.brandId })
    .from(productLines)
    .orderBy(asc(productLines.name));
}

// ---------- Categories ----------

const categoryVi = alias(categoryTranslations, 'category_vi');
const categoryEn = alias(categoryTranslations, 'category_en');

export type CategoryRow = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  name: string;
  slug: string;
  viStatus: TranslationStatus;
  enStatus: TranslationStatus;
  productCount: number;
};

/** Whole tree (small): roots first, children right after their parent. */
export async function listCategories(db: Reader, query?: { q?: string }): Promise<CategoryRow[]> {
  const productCount = sql<number>`(select count(*) from ${productCategories} pc join ${products} p on p.id = pc.product_id where pc.category_id = ${categories.id} and p.deleted_at is null)`;
  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      name: sql<string>`coalesce(${categoryVi.name}, '')`,
      slug: sql<string>`coalesce(${categoryVi.slug}, '')`,
      viStatus: statusSql(
        sql`${categoryVi.categoryId} is not null`,
        sql`${categoryVi.isPublished}`,
      ),
      enStatus: statusSql(
        sql`${categoryEn.categoryId} is not null`,
        sql`${categoryEn.isPublished}`,
      ),
      productCount: productCount.mapWith(Number),
    })
    .from(categories)
    .leftJoin(
      categoryVi,
      and(eq(categoryVi.categoryId, categories.id), eq(categoryVi.locale, 'vi')),
    )
    .leftJoin(
      categoryEn,
      and(eq(categoryEn.categoryId, categories.id), eq(categoryEn.locale, 'en')),
    )
    .where(
      and(
        isNull(categories.deletedAt),
        query?.q ? foldedContains(categoryVi.name, query.q) : undefined,
      ),
    )
    .orderBy(asc(categories.sortOrder), asc(categoryVi.name));
  return orderTree(rows);
}

export function orderTree<T extends { id: string; parentId: string | null }>(rows: T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  const roots = rows.filter((row) => !row.parentId || !ids.has(row.parentId));
  return roots.flatMap((root) => [root, ...rows.filter((row) => row.parentId === root.id)]);
}

export async function getCategory(db: Reader, id: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)));
  if (!category) return null;
  const translations = await db
    .select({
      locale: categoryTranslations.locale,
      name: categoryTranslations.name,
      slug: categoryTranslations.slug,
      description: categoryTranslations.description,
      seoTitle: categoryTranslations.seoTitle,
      seoDescription: categoryTranslations.seoDescription,
      isPublished: categoryTranslations.isPublished,
    })
    .from(categoryTranslations)
    .where(eq(categoryTranslations.categoryId, id));
  const [children] = await db
    .select({ n: count() })
    .from(categories)
    .where(and(eq(categories.parentId, id), isNull(categories.deletedAt)));
  return { ...category, translations: byLocale(translations), childCount: children?.n ?? 0 };
}
export type CategoryDetail = NonNullable<Awaited<ReturnType<typeof getCategory>>>;

// ---------- Collections ----------

const collectionVi = alias(collectionTranslations, 'collection_vi');
const collectionEn = alias(collectionTranslations, 'collection_en');

export type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  viStatus: TranslationStatus;
  enStatus: TranslationStatus;
  productCount: number;
  updatedAt: Date;
};

export async function listCollections(db: Reader, query: ListQuery): Promise<Paged<CollectionRow>> {
  const productCount = sql<number>`(select count(*) from ${collectionProducts} where ${collectionProducts.collectionId} = ${collections.id})`;
  const where = query.q ? foldedContains(collectionVi.name, query.q) : undefined;
  const order =
    query.sort === 'name'
      ? direction(query.dir)(collectionVi.name)
      : direction(query.dir)(collections.updatedAt);
  return paged(
    db
      .select({
        id: collections.id,
        name: sql<string>`coalesce(${collectionVi.name}, '')`,
        slug: sql<string>`coalesce(${collectionVi.slug}, '')`,
        isActive: collections.isActive,
        startsAt: collections.startsAt,
        endsAt: collections.endsAt,
        viStatus: statusSql(
          sql`${collectionVi.collectionId} is not null`,
          sql`${collectionVi.isPublished}`,
        ),
        enStatus: statusSql(
          sql`${collectionEn.collectionId} is not null`,
          sql`${collectionEn.isPublished}`,
        ),
        productCount: productCount.mapWith(Number),
        updatedAt: collections.updatedAt,
      })
      .from(collections)
      .leftJoin(
        collectionVi,
        and(eq(collectionVi.collectionId, collections.id), eq(collectionVi.locale, 'vi')),
      )
      .leftJoin(
        collectionEn,
        and(eq(collectionEn.collectionId, collections.id), eq(collectionEn.locale, 'en')),
      )
      .where(where)
      .orderBy(order, asc(collections.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(collections)
      .leftJoin(
        collectionVi,
        and(eq(collectionVi.collectionId, collections.id), eq(collectionVi.locale, 'vi')),
      )
      .where(where),
    query,
  );
}

export async function getCollection(db: Reader, id: string) {
  const [collection] = await db.select().from(collections).where(eq(collections.id, id));
  if (!collection) return null;
  const translations = await db
    .select({
      locale: collectionTranslations.locale,
      name: collectionTranslations.name,
      slug: collectionTranslations.slug,
      description: collectionTranslations.description,
      seoTitle: collectionTranslations.seoTitle,
      seoDescription: collectionTranslations.seoDescription,
      isPublished: collectionTranslations.isPublished,
    })
    .from(collectionTranslations)
    .where(eq(collectionTranslations.collectionId, id));
  const productRows = await db
    .select({
      id: products.id,
      name: sql<string>`coalesce(${productTranslations.name}, '')`,
      brandName: brands.name,
      status: products.status,
    })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'vi')),
    )
    .where(and(eq(collectionProducts.collectionId, id), isNull(products.deletedAt)))
    .orderBy(asc(collectionProducts.position));
  const hero = collection.heroMediaId ? await getMediaItems(db, [collection.heroMediaId]) : [];
  return {
    ...collection,
    translations: byLocale(translations),
    products: productRows,
    hero: hero[0] ?? null,
  };
}
export type CollectionDetail = NonNullable<Awaited<ReturnType<typeof getCollection>>>;

// ---------- Scent families and notes ----------

export type TaxonomyKind = 'family' | 'note';

const familyVi = alias(fragranceFamilyTranslations, 'family_vi');
const familyEn = alias(fragranceFamilyTranslations, 'family_en');
const noteVi = alias(fragranceNoteTranslations, 'note_vi');
const noteEn = alias(fragranceNoteTranslations, 'note_en');

const TAXONOMY = {
  family: {
    base: fragranceFamilies,
    tr: fragranceFamilyTranslations,
    fk: fragranceFamilyTranslations.familyId,
    vi: {
      table: familyVi,
      fk: familyVi.familyId,
      name: familyVi.name,
      slug: familyVi.slug,
      locale: familyVi.locale,
    },
    en: {
      table: familyEn,
      fk: familyEn.familyId,
      name: familyEn.name,
      slug: familyEn.slug,
      locale: familyEn.locale,
    },
    usage: productFamilies,
    usageFk: productFamilies.familyId,
  },
  note: {
    base: fragranceNotes,
    tr: fragranceNoteTranslations,
    fk: fragranceNoteTranslations.noteId,
    vi: {
      table: noteVi,
      fk: noteVi.noteId,
      name: noteVi.name,
      slug: noteVi.slug,
      locale: noteVi.locale,
    },
    en: {
      table: noteEn,
      fk: noteEn.noteId,
      name: noteEn.name,
      slug: noteEn.slug,
      locale: noteEn.locale,
    },
    usage: productNotes,
    usageFk: productNotes.noteId,
  },
} as const;

export type TaxonomyRow = {
  id: string;
  name: string;
  slug: string;
  enName: string | null;
  enStatus: TranslationStatus;
  productCount: number;
};

export async function listTaxonomy(
  db: Reader,
  kind: TaxonomyKind,
  query: ListQuery,
): Promise<Paged<TaxonomyRow>> {
  const spec = TAXONOMY[kind];
  const { vi, en } = spec;
  const viFk = vi.fk;
  const enFk = en.fk;
  const productCount = sql<number>`(select count(distinct product_id) from ${spec.usage} where ${spec.usageFk} = ${spec.base.id})`;
  const where = query.q
    ? or(foldedContains(vi.name, query.q), foldedContains(en.name, query.q))
    : undefined;
  const order =
    query.sort === 'productCount'
      ? direction(query.dir)(productCount)
      : direction(query.sort ? query.dir : 'asc')(vi.name);
  return paged(
    db
      .select({
        id: spec.base.id,
        name: sql<string>`coalesce(${vi.name}, '')`,
        slug: sql<string>`coalesce(${vi.slug}, '')`,
        enName: en.name,
        enStatus: statusSql(sql`${enFk} is not null`, null),
        productCount: productCount.mapWith(Number),
      })
      .from(spec.base)
      .leftJoin(vi.table, and(eq(viFk, spec.base.id), eq(vi.locale, 'vi')))
      .leftJoin(en.table, and(eq(enFk, spec.base.id), eq(en.locale, 'en')))
      .where(where)
      .orderBy(order, asc(spec.base.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(spec.base)
      .leftJoin(vi.table, and(eq(viFk, spec.base.id), eq(vi.locale, 'vi')))
      .leftJoin(en.table, and(eq(enFk, spec.base.id), eq(en.locale, 'en')))
      .where(where),
    query,
  );
}

export async function getTaxonomy(db: Reader, kind: TaxonomyKind, id: string) {
  const spec = TAXONOMY[kind];
  const [row] = await db.select().from(spec.base).where(eq(spec.base.id, id));
  if (!row) return null;
  const translations = await db
    .select({
      locale: spec.tr.locale,
      name: spec.tr.name,
      slug: spec.tr.slug,
      description: spec.tr.description,
    })
    .from(spec.tr)
    .where(eq(spec.fk, id));
  const image = row.imageMediaId ? await getMediaItems(db, [row.imageMediaId]) : [];
  return {
    id: row.id,
    imageMediaId: row.imageMediaId,
    translations: byLocale(translations),
    image: image[0] ?? null,
  };
}
export type TaxonomyDetail = NonNullable<Awaited<ReturnType<typeof getTaxonomy>>>;

export async function taxonomyOptions(db: Reader, kind: TaxonomyKind) {
  const spec = TAXONOMY[kind];
  const rows = await db
    .select({ id: spec.base.id, name: spec.tr.name })
    .from(spec.base)
    .innerJoin(spec.tr, and(eq(spec.fk, spec.base.id), eq(spec.tr.locale, 'vi')))
    .orderBy(asc(spec.tr.name));
  return rows;
}

// ---------- Products ----------

const productVi = alias(productTranslations, 'product_vi');
const productEn = alias(productTranslations, 'product_en');

export type ProductListRow = {
  id: string;
  name: string;
  brandName: string;
  concentration: string;
  status: 'draft' | 'active' | 'archived';
  enStatus: TranslationStatus;
  variantCount: number;
  minPrice: number | null;
  stock: number;
  updatedAt: Date;
};

export const PRODUCT_SORTS = ['name', 'brand', 'updatedAt', 'minPrice', 'stock'] as const;

export async function listProducts(
  db: Reader,
  query: ListQuery & { status?: string | null; brandId?: string | null },
): Promise<Paged<ProductListRow>> {
  const minPrice = sql<
    number | null
  >`(select min(${productVariants.price}) from ${productVariants} where ${productVariants.productId} = ${products.id} and ${productVariants.isActive})`;
  const variantCount = sql<number>`(select count(*) from ${productVariants} where ${productVariants.productId} = ${products.id})`;
  const stock = sql<number>`(select coalesce(sum(${inventoryItems.onHand} - ${inventoryItems.reserved}), 0) from ${inventoryItems} join ${productVariants} pv on pv.id = ${inventoryItems.variantId} where pv.product_id = ${products.id})`;
  const where = and(
    isNull(products.deletedAt),
    query.q
      ? or(
          foldedContains(productVi.name, query.q),
          foldedContains(brands.name, query.q),
          sql`exists (select 1 from ${productVariants} where ${productVariants.productId} = ${products.id} and ${productVariants.sku} ilike ${`%${query.q.replace(/[\\%_]/g, '\\$&')}%`})`,
        )
      : undefined,
    query.status ? eq(products.status, query.status as ProductListRow['status']) : undefined,
    query.brandId ? eq(products.brandId, query.brandId) : undefined,
  );
  const dir = direction(query.dir);
  const order = (() => {
    switch (query.sort) {
      case 'name':
        return dir(productVi.name);
      case 'brand':
        return dir(brands.name);
      case 'minPrice':
        return dir(minPrice);
      case 'stock':
        return dir(stock);
      default:
        return dir(products.updatedAt);
    }
  })();
  return paged(
    db
      .select({
        id: products.id,
        name: sql<string>`coalesce(${productVi.name}, '')`,
        brandName: brands.name,
        concentration: products.concentration,
        status: products.status,
        enStatus: statusSql(sql`${productEn.productId} is not null`, sql`${productEn.isPublished}`),
        variantCount: variantCount.mapWith(Number),
        minPrice: minPrice.mapWith((value) => (value === null ? null : Number(value))),
        stock: stock.mapWith(Number),
        updatedAt: products.updatedAt,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(productVi, and(eq(productVi.productId, products.id), eq(productVi.locale, 'vi')))
      .leftJoin(productEn, and(eq(productEn.productId, products.id), eq(productEn.locale, 'en')))
      .where(where)
      .orderBy(order, asc(products.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(productVi, and(eq(productVi.productId, products.id), eq(productVi.locale, 'vi')))
      .where(where),
    query,
  );
}

/** Product picker for collections: search by name/brand, newest first. */
export async function searchProductOptions(db: Reader, q: string, limit = 20) {
  return db
    .select({
      id: products.id,
      name: sql<string>`coalesce(${productVi.name}, '')`,
      brandName: brands.name,
      status: products.status,
    })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(productVi, and(eq(productVi.productId, products.id), eq(productVi.locale, 'vi')))
    .where(
      and(
        isNull(products.deletedAt),
        q ? or(foldedContains(productVi.name, q), foldedContains(brands.name, q)) : undefined,
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(limit);
}

export type MediaItem = {
  id: string;
  storageKey: string;
  url: string;
  width: number | null;
  height: number | null;
  mime: string;
  sizeBytes: number;
  blurDataUrl: string | null;
  alt: { vi: string | null; en: string | null };
};

export async function getMediaItems(db: Reader, ids: string[]): Promise<MediaItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(media).where(inArray(media.id, ids));
  const alts = await db
    .select()
    .from(mediaTranslations)
    .where(inArray(mediaTranslations.mediaId, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => ({
      id: row.id,
      storageKey: row.storageKey,
      url: row.url,
      width: row.width,
      height: row.height,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      blurDataUrl: row.blurDataUrl,
      alt: {
        vi: alts.find((a) => a.mediaId === row.id && a.locale === 'vi')?.alt ?? null,
        en: alts.find((a) => a.mediaId === row.id && a.locale === 'en')?.alt ?? null,
      },
    }));
}

/** Everything the ProductEditor needs for one product. */
export async function getProductForEdit(db: Reader, id: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)));
  if (!product) return null;
  const [translations, variants, cats, notes, families, mediaRows] = await Promise.all([
    db
      .select({
        locale: productTranslations.locale,
        name: productTranslations.name,
        slug: productTranslations.slug,
        subtitle: productTranslations.subtitle,
        description: productTranslations.description,
        seoTitle: productTranslations.seoTitle,
        seoDescription: productTranslations.seoDescription,
        isPublished: productTranslations.isPublished,
      })
      .from(productTranslations)
      .where(eq(productTranslations.productId, id)),
    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        sizeMl: productVariants.sizeMl,
        variantType: productVariants.variantType,
        price: productVariants.price,
        compareAtPrice: productVariants.compareAtPrice,
        costPrice: productVariants.costPrice,
        weightG: productVariants.weightG,
        isDefault: productVariants.isDefault,
        isActive: productVariants.isActive,
        onHand: sql<number>`coalesce(${inventoryItems.onHand}, 0)`.mapWith(Number),
        reserved: sql<number>`coalesce(${inventoryItems.reserved}, 0)`.mapWith(Number),
      })
      .from(productVariants)
      .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.position), asc(productVariants.createdAt)),
    db
      .select({ id: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, id)),
    db
      .select({ noteId: productNotes.noteId, layer: productNotes.layer })
      .from(productNotes)
      .where(eq(productNotes.productId, id))
      .orderBy(asc(productNotes.position)),
    db
      .select({ familyId: productFamilies.familyId, isPrimary: productFamilies.isPrimary })
      .from(productFamilies)
      .where(eq(productFamilies.productId, id)),
    db
      .select({ mediaId: productMedia.mediaId, variantId: productMedia.variantId })
      .from(productMedia)
      .where(eq(productMedia.productId, id))
      .orderBy(asc(productMedia.position)),
  ]);
  const items = await getMediaItems(
    db,
    mediaRows.map((row) => row.mediaId),
  );
  return {
    product,
    translations: byLocale(translations),
    variants,
    categoryIds: cats.map((row) => row.id),
    notes: {
      top: notes.filter((n) => n.layer === 'top').map((n) => n.noteId),
      middle: notes.filter((n) => n.layer === 'middle').map((n) => n.noteId),
      base: notes.filter((n) => n.layer === 'base').map((n) => n.noteId),
    },
    families,
    media: mediaRows.map((row) => ({
      ...items.find((item) => item.id === row.mediaId)!,
      variantId: row.variantId,
    })),
  };
}
export type ProductForEdit = NonNullable<Awaited<ReturnType<typeof getProductForEdit>>>;

/** Options for the editor's selects (small lists in MVP). */
export async function productEditorOptions(db: Reader) {
  const [brandList, lines, categoryList, notes, families] = await Promise.all([
    brandOptions(db),
    productLineOptions(db),
    listCategories(db),
    taxonomyOptions(db, 'note'),
    taxonomyOptions(db, 'family'),
  ]);
  return {
    brands: brandList,
    productLines: lines,
    categories: categoryList.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    notes,
    families,
  };
}
export type ProductEditorOptions = Awaited<ReturnType<typeof productEditorOptions>>;
