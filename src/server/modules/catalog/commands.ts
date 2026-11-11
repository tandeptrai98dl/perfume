import { and, count, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';

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
import { uniqueSlug } from '@/lib/slug';
import { diffRecords, prefixDiff, recordAudit, type AuditDiff } from '@/server/lib/audit';
import {
  assertCan,
  can,
  DomainError,
  enqueueRevalidation,
  isUniqueViolation,
  type CommandContext,
  type CommandResult,
  type FieldIssue,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { ensureInventoryItems } from '@/server/modules/inventory';

import type {
  BrandInput,
  CategoryInput,
  CollectionInput,
  ProductCreateInput,
  ProductLineInput,
  ProductSaveInput,
  TaxonomyInput,
} from './admin-schemas';
import { NOTE_LAYERS } from './admin-schemas';
import { catalogTags } from './cache-tags';
import {
  detectSlugChanges,
  type SlugChange,
  type SlugChangeHook,
  type SlugEntityType,
} from './slug-changes';
import {
  assertSlugsAvailable,
  diffTranslations,
  existingIds,
  readTranslations,
  slugStates,
  writeTranslations,
  type StoredTranslations,
  type TranslationSet,
  type TranslationTable,
} from './translatable';
import { priceFieldViolations, variantSetIssues, type VariantPrices } from './variant-rules';

/*
 * Catalogue write side (ARCHITECTURE.md §11.2). Every command:
 * 1. re-checks the permission (the Server Action checked it first);
 * 2. runs in one transaction: change + audit_logs row + `cache.revalidate` outbox job;
 * 3. reports slug changes of published pages and passes them to `onSlugChanges` in the same
 *    transaction, so the content module can write 301 redirects atomically;
 * 4. returns the cache tags so the action can also revalidate immediately.
 */

export type CatalogContext = CommandContext & { onSlugChanges?: SlugChangeHook };
export type EntityWriteResult = { id: string; slugChanges: SlugChange[] };

// ---------- shared plumbing ----------

function omit<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

const TR = {
  brand: {
    table: brandTranslations,
    fkKey: 'brandId',
    fk: brandTranslations.brandId,
    locale: brandTranslations.locale,
    slug: brandTranslations.slug,
  },
  category: {
    table: categoryTranslations,
    fkKey: 'categoryId',
    fk: categoryTranslations.categoryId,
    locale: categoryTranslations.locale,
    slug: categoryTranslations.slug,
  },
  collection: {
    table: collectionTranslations,
    fkKey: 'collectionId',
    fk: collectionTranslations.collectionId,
    locale: collectionTranslations.locale,
    slug: collectionTranslations.slug,
  },
  family: {
    table: fragranceFamilyTranslations,
    fkKey: 'familyId',
    fk: fragranceFamilyTranslations.familyId,
    locale: fragranceFamilyTranslations.locale,
    slug: fragranceFamilyTranslations.slug,
  },
  note: {
    table: fragranceNoteTranslations,
    fkKey: 'noteId',
    fk: fragranceNoteTranslations.noteId,
    locale: fragranceNoteTranslations.locale,
    slug: fragranceNoteTranslations.slug,
  },
  product: {
    table: productTranslations,
    fkKey: 'productId',
    fk: productTranslations.productId,
    locale: productTranslations.locale,
    slug: productTranslations.slug,
  },
} satisfies Record<string, TranslationTable>;

type Finish = {
  action: string;
  entityType: string;
  entityId: string;
  diff: AuditDiff | Record<string, unknown>;
  tags: string[];
  slugChanges?: SlugChange[];
};

async function finish(ctx: CatalogContext, tx: Tx, done: Finish): Promise<string[]> {
  if (done.slugChanges?.length && ctx.onSlugChanges) await ctx.onSlugChanges(tx, done.slugChanges);
  await recordAudit(tx, {
    actorId: ctx.actor.id,
    action: done.action,
    entityType: done.entityType,
    entityId: done.entityId,
    diff: done.diff,
    ip: ctx.ip,
  });
  return enqueueRevalidation(ctx.boss, tx, done.tags);
}

/** Editing translations needs `translations.edit` on top of the entity permission (§11.1). */
function assertTranslationPermission(ctx: CatalogContext, diff: AuditDiff) {
  if (Object.keys(diff).length > 0) assertCan(ctx.actor, 'translations.edit');
}

async function assertMediaExists(tx: Tx, ids: (string | null)[], path: string) {
  const wanted = ids.filter((id): id is string => !!id);
  const found = await existingIds(tx, media, media.id, wanted);
  if (found.size !== new Set(wanted).size) {
    throw new DomainError('invalid', [{ path, code: 'notFound' }]);
  }
}

async function productIdsWhere(tx: Tx, where: ReturnType<typeof eq>): Promise<string[]> {
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(where, isNull(products.deletedAt)));
  return rows.map((row) => row.id);
}

/** Generic create/update for an entity with a base row and a translation table. */
async function saveTranslatable<TBase extends Record<string, unknown>>(
  ctx: CatalogContext,
  options: {
    entityType: string;
    slugEntity: SlugEntityType | null;
    tr: TranslationTable;
    id: string | null;
    loadBase: (tx: Tx, id: string) => Promise<TBase | undefined>;
    insertBase: (tx: Tx, id: string) => Promise<void>;
    updateBase: (tx: Tx, id: string) => Promise<void>;
    base: TBase;
    translations: TranslationSet;
    validate?: (tx: Tx, id: string | null) => Promise<void>;
    tags: (tx: Tx, id: string) => Promise<string[]> | string[];
  },
): Promise<CommandResult<EntityWriteResult>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    let before: TBase | null = null;
    let beforeTranslations: StoredTranslations = {};
    if (options.id) {
      before = (await options.loadBase(tx, options.id)) ?? null;
      if (!before) throw new DomainError('notFound');
      beforeTranslations = await readTranslations(tx, options.tr, options.id);
    }
    await options.validate?.(tx, options.id);
    await assertSlugsAvailable(tx, options.tr, options.id, options.translations);

    const translationDiff = diffTranslations(beforeTranslations, options.translations);
    assertTranslationPermission(ctx, translationDiff);

    const id = options.id ?? newId();
    if (options.id) await options.updateBase(tx, id);
    else await options.insertBase(tx, id);
    await writeTranslations(tx, options.tr, id, options.translations);

    const slugChanges = options.slugEntity
      ? detectSlugChanges(
          options.slugEntity,
          id,
          slugStates(beforeTranslations),
          slugStates(options.translations),
        )
      : [];
    const tags = await finish(ctx, tx, {
      action: `${options.entityType}.${options.id ? 'update' : 'create'}`,
      entityType: options.entityType,
      entityId: id,
      diff: {
        ...diffRecords(before, options.base),
        ...prefixDiff('translations.', translationDiff),
      },
      tags: await options.tags(tx, id),
      slugChanges,
    });
    return { data: { id, slugChanges }, tags };
  });
}

// ---------- Brands ----------

export async function saveBrand(ctx: CatalogContext, id: string | null, input: BrandInput) {
  const base = {
    name: input.name,
    country: input.country,
    logoMediaId: input.logoMediaId,
    isFeatured: input.isFeatured,
    status: input.status,
  };
  return saveTranslatable(ctx, {
    entityType: 'brand',
    slugEntity: 'brand',
    tr: TR.brand,
    id,
    base,
    translations: input.translations,
    loadBase: async (tx, brandId) => {
      const [row] = await tx
        .select({
          name: brands.name,
          country: brands.country,
          logoMediaId: brands.logoMediaId,
          isFeatured: brands.isFeatured,
          status: brands.status,
        })
        .from(brands)
        .where(and(eq(brands.id, brandId), isNull(brands.deletedAt)))
        .for('update');
      return row;
    },
    validate: (tx) => assertMediaExists(tx, [input.logoMediaId], 'logoMediaId'),
    insertBase: async (tx, brandId) => {
      await tx.insert(brands).values({ id: brandId, ...base });
    },
    updateBase: async (tx, brandId) => {
      await tx.update(brands).set(base).where(eq(brands.id, brandId));
    },
    // Brand names appear on product cards and pages.
    tags: async (tx, brandId) => [
      catalogTags.brand(brandId),
      catalogTags.brandList,
      catalogTags.productList,
      ...(await productIdsWhere(tx, eq(products.brandId, brandId))).map(catalogTags.product),
    ],
  });
}

export async function deleteBrand(ctx: CatalogContext, id: string) {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const [brand] = await tx
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), isNull(brands.deletedAt)))
      .for('update');
    if (!brand) throw new DomainError('notFound');
    const [inUse] = await tx
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.brandId, id), isNull(products.deletedAt)));
    if ((inUse?.n ?? 0) > 0) throw new DomainError('inUse');
    await tx
      .update(brands)
      .set({ deletedAt: new Date(), status: 'archived' })
      .where(eq(brands.id, id));
    const tags = await finish(ctx, tx, {
      action: 'brand.delete',
      entityType: 'brand',
      entityId: id,
      diff: { name: { from: brand.name, to: null } },
      tags: [catalogTags.brand(id), catalogTags.brandList],
    });
    return { data: { id }, tags };
  });
}

// ---------- Product lines ----------

export async function saveProductLine(
  ctx: CatalogContext,
  id: string | null,
  input: ProductLineInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const brandOk = await existingIds(
      tx,
      brands,
      brands.id,
      [input.brandId],
      isNull(brands.deletedAt),
    );
    if (brandOk.size === 0)
      throw new DomainError('invalid', [{ path: 'brandId', code: 'notFound' }]);
    let before: ProductLineInput | null = null;
    if (id) {
      const [row] = await tx
        .select({ brandId: productLines.brandId, name: productLines.name })
        .from(productLines)
        .where(eq(productLines.id, id))
        .for('update');
      if (!row) throw new DomainError('notFound');
      before = row;
      if (row.brandId !== input.brandId) {
        const [used] = await tx
          .select({ n: count() })
          .from(products)
          .where(and(eq(products.productLineId, id), isNull(products.deletedAt)));
        if ((used?.n ?? 0) > 0) {
          throw new DomainError('inUse', [{ path: 'brandId', code: 'lineHasProducts' }]);
        }
      }
      await tx.update(productLines).set(input).where(eq(productLines.id, id));
    }
    const lineId = id ?? newId();
    if (!id) await tx.insert(productLines).values({ id: lineId, ...input });
    const tags = await finish(ctx, tx, {
      action: `product_line.${id ? 'update' : 'create'}`,
      entityType: 'product_line',
      entityId: lineId,
      diff: diffRecords(before, input),
      // The PDP concentration switcher lists the products of a line.
      tags: (await productIdsWhere(tx, eq(products.productLineId, lineId))).map(
        catalogTags.product,
      ),
    });
    return { data: { id: lineId }, tags };
  });
}

export async function deleteProductLine(ctx: CatalogContext, id: string) {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(productLines)
      .where(eq(productLines.id, id))
      .for('update');
    if (!line) throw new DomainError('notFound');
    const affected = await productIdsWhere(tx, eq(products.productLineId, id));
    // products.product_line_id is ON DELETE SET NULL.
    await tx.delete(productLines).where(eq(productLines.id, id));
    const tags = await finish(ctx, tx, {
      action: 'product_line.delete',
      entityType: 'product_line',
      entityId: id,
      diff: { name: { from: line.name, to: null } },
      tags: affected.map(catalogTags.product),
    });
    return { data: { id }, tags };
  });
}

// ---------- Categories (2-level tree) ----------

export async function saveCategory(ctx: CatalogContext, id: string | null, input: CategoryInput) {
  const base = { parentId: input.parentId, sortOrder: input.sortOrder };
  return saveTranslatable(ctx, {
    entityType: 'category',
    slugEntity: 'category',
    tr: TR.category,
    id,
    base,
    translations: input.translations,
    loadBase: async (tx, categoryId) => {
      const [row] = await tx
        .select({ parentId: categories.parentId, sortOrder: categories.sortOrder })
        .from(categories)
        .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
        .for('update');
      return row;
    },
    validate: async (tx, categoryId) => {
      if (!input.parentId) return;
      if (input.parentId === categoryId) {
        throw new DomainError('invalid', [{ path: 'parentId', code: 'invalid' }]);
      }
      const [parent] = await tx
        .select({ parentId: categories.parentId })
        .from(categories)
        .where(and(eq(categories.id, input.parentId), isNull(categories.deletedAt)));
      if (!parent) throw new DomainError('invalid', [{ path: 'parentId', code: 'notFound' }]);
      // Two levels only: the parent must be a root, and a parent cannot become a child.
      if (parent.parentId)
        throw new DomainError('invalid', [{ path: 'parentId', code: 'tooDeep' }]);
      if (categoryId) {
        const [children] = await tx
          .select({ n: count() })
          .from(categories)
          .where(and(eq(categories.parentId, categoryId), isNull(categories.deletedAt)));
        if ((children?.n ?? 0) > 0) {
          throw new DomainError('invalid', [{ path: 'parentId', code: 'tooDeep' }]);
        }
      }
    },
    insertBase: async (tx, categoryId) => {
      await tx.insert(categories).values({ id: categoryId, ...base });
    },
    updateBase: async (tx, categoryId) => {
      await tx.update(categories).set(base).where(eq(categories.id, categoryId));
    },
    tags: (_tx, categoryId) => [catalogTags.category(categoryId), catalogTags.categoryTree],
  });
}

export async function deleteCategory(ctx: CatalogContext, id: string) {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .for('update');
    if (!category) throw new DomainError('notFound');
    const [children] = await tx
      .select({ n: count() })
      .from(categories)
      .where(and(eq(categories.parentId, id), isNull(categories.deletedAt)));
    if ((children?.n ?? 0) > 0) throw new DomainError('inUse');
    await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
    const tags = await finish(ctx, tx, {
      action: 'category.delete',
      entityType: 'category',
      entityId: id,
      diff: { deletedAt: { from: null, to: new Date().toISOString() } },
      tags: [catalogTags.category(id), catalogTags.categoryTree, catalogTags.productList],
    });
    return { data: { id }, tags };
  });
}

// ---------- Collections (manual ordering) ----------

export async function saveCollection(
  ctx: CatalogContext,
  id: string | null,
  input: CollectionInput,
) {
  const base = {
    heroMediaId: input.heroMediaId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive,
  };
  return saveTranslatable(ctx, {
    entityType: 'collection',
    slugEntity: 'collection',
    tr: TR.collection,
    id,
    base,
    translations: input.translations,
    loadBase: async (tx, collectionId) => {
      const [row] = await tx
        .select({
          heroMediaId: collections.heroMediaId,
          startsAt: collections.startsAt,
          endsAt: collections.endsAt,
          isActive: collections.isActive,
        })
        .from(collections)
        .where(eq(collections.id, collectionId))
        .for('update');
      return row;
    },
    validate: (tx) => assertMediaExists(tx, [input.heroMediaId], 'heroMediaId'),
    insertBase: async (tx, collectionId) => {
      await tx.insert(collections).values({ id: collectionId, kind: 'manual', ...base });
    },
    updateBase: async (tx, collectionId) => {
      await tx.update(collections).set(base).where(eq(collections.id, collectionId));
    },
    tags: (_tx, collectionId) => [catalogTags.collection(collectionId), catalogTags.collectionList],
  });
}

export async function setCollectionProducts(
  ctx: CatalogContext,
  input: { collectionId: string; productIds: string[] },
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const [collection] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.id, input.collectionId))
      .for('update');
    if (!collection) throw new DomainError('notFound');
    const found = await existingIds(
      tx,
      products,
      products.id,
      input.productIds,
      isNull(products.deletedAt),
    );
    if (found.size !== input.productIds.length) {
      throw new DomainError('invalid', [{ path: 'productIds', code: 'notFound' }]);
    }
    const before = await tx
      .select({ productId: collectionProducts.productId })
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, input.collectionId))
      .orderBy(collectionProducts.position);
    await tx
      .delete(collectionProducts)
      .where(eq(collectionProducts.collectionId, input.collectionId));
    if (input.productIds.length > 0) {
      await tx.insert(collectionProducts).values(
        input.productIds.map((productId, position) => ({
          collectionId: input.collectionId,
          productId,
          position,
        })),
      );
    }
    const tags = await finish(ctx, tx, {
      action: 'collection.products',
      entityType: 'collection',
      entityId: input.collectionId,
      diff: diffRecords(
        { productIds: before.map((row) => row.productId) },
        { productIds: input.productIds },
      ),
      tags: [catalogTags.collection(input.collectionId), catalogTags.collectionList],
    });
    return { data: { id: input.collectionId }, tags };
  });
}

export async function deleteCollection(ctx: CatalogContext, id: string) {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(collections).where(eq(collections.id, id)).for('update');
    if (!row) throw new DomainError('notFound');
    const names = await readTranslations(tx, TR.collection, id);
    await tx.delete(collections).where(eq(collections.id, id));
    const tags = await finish(ctx, tx, {
      action: 'collection.delete',
      entityType: 'collection',
      entityId: id,
      diff: { name: { from: names.vi?.name ?? null, to: null } },
      tags: [catalogTags.collection(id), catalogTags.collectionList],
    });
    return { data: { id }, tags };
  });
}

// ---------- Scent families and notes ----------

export async function saveFamily(ctx: CatalogContext, id: string | null, input: TaxonomyInput) {
  const base = { imageMediaId: input.imageMediaId };
  return saveTranslatable(ctx, {
    entityType: 'fragrance_family',
    slugEntity: 'family',
    tr: TR.family,
    id,
    base,
    translations: input.translations,
    loadBase: async (tx, familyId) => {
      const [row] = await tx
        .select({ imageMediaId: fragranceFamilies.imageMediaId })
        .from(fragranceFamilies)
        .where(eq(fragranceFamilies.id, familyId))
        .for('update');
      return row;
    },
    validate: (tx) => assertMediaExists(tx, [input.imageMediaId], 'imageMediaId'),
    insertBase: async (tx, familyId) => {
      await tx.insert(fragranceFamilies).values({ id: familyId, ...base });
    },
    updateBase: async (tx, familyId) => {
      await tx.update(fragranceFamilies).set(base).where(eq(fragranceFamilies.id, familyId));
    },
    tags: async (tx, familyId) => {
      const rows = await tx
        .select({ id: productFamilies.productId })
        .from(productFamilies)
        .where(eq(productFamilies.familyId, familyId));
      return [
        catalogTags.family(familyId),
        catalogTags.familyList,
        catalogTags.productList,
        ...rows.map((row) => catalogTags.product(row.id)),
      ];
    },
  });
}

export async function saveNote(ctx: CatalogContext, id: string | null, input: TaxonomyInput) {
  const base = { imageMediaId: input.imageMediaId };
  return saveTranslatable(ctx, {
    entityType: 'fragrance_note',
    slugEntity: null,
    tr: TR.note,
    id,
    base,
    translations: input.translations,
    loadBase: async (tx, noteId) => {
      const [row] = await tx
        .select({ imageMediaId: fragranceNotes.imageMediaId })
        .from(fragranceNotes)
        .where(eq(fragranceNotes.id, noteId))
        .for('update');
      return row;
    },
    validate: (tx) => assertMediaExists(tx, [input.imageMediaId], 'imageMediaId'),
    insertBase: async (tx, noteId) => {
      await tx.insert(fragranceNotes).values({ id: noteId, ...base });
    },
    updateBase: async (tx, noteId) => {
      await tx.update(fragranceNotes).set(base).where(eq(fragranceNotes.id, noteId));
    },
    tags: async (tx, noteId) => {
      const rows = await tx
        .selectDistinct({ id: productNotes.productId })
        .from(productNotes)
        .where(eq(productNotes.noteId, noteId));
      return [catalogTags.noteList, ...rows.map((row) => catalogTags.product(row.id))];
    },
  });
}

async function deleteTaxonomy(
  ctx: CatalogContext,
  kind: 'family' | 'note',
  id: string,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  const table = kind === 'family' ? fragranceFamilies : fragranceNotes;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .for('update');
    if (!row) throw new DomainError('notFound');
    const [used] =
      kind === 'family'
        ? await tx
            .select({ n: count() })
            .from(productFamilies)
            .where(eq(productFamilies.familyId, id))
        : await tx.select({ n: count() }).from(productNotes).where(eq(productNotes.noteId, id));
    // Deleting would silently strip the family/note from every product using it.
    if ((used?.n ?? 0) > 0) throw new DomainError('inUse');
    const names = await readTranslations(tx, TR[kind], id);
    await tx.delete(table).where(eq(table.id, id));
    const tags = await finish(ctx, tx, {
      action: `fragrance_${kind}.delete`,
      entityType: `fragrance_${kind}`,
      entityId: id,
      diff: { name: { from: names.vi?.name ?? null, to: null } },
      tags:
        kind === 'family'
          ? [catalogTags.family(id), catalogTags.familyList]
          : [catalogTags.noteList],
    });
    return { data: { id }, tags };
  });
}

export const deleteFamily = (ctx: CatalogContext, id: string) => deleteTaxonomy(ctx, 'family', id);
export const deleteNote = (ctx: CatalogContext, id: string) => deleteTaxonomy(ctx, 'note', id);

// ---------- Products ----------

async function lockProduct(tx: Tx, id: string) {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)))
    .for('update');
  if (!product) throw new DomainError('notFound');
  return product;
}

/** Every listing that can show the product: its page, lists, brand, categories, families, collections. */
async function productTags(tx: Tx, productId: string, extraBrandIds: string[] = []) {
  const [product] = await tx
    .select({ brandId: products.brandId })
    .from(products)
    .where(eq(products.id, productId));
  // Sequential on purpose: a transaction is one connection (no concurrent queries).
  const cats = await tx
    .select({ id: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.productId, productId));
  const fams = await tx
    .select({ id: productFamilies.familyId })
    .from(productFamilies)
    .where(eq(productFamilies.productId, productId));
  const cols = await tx
    .select({ id: collectionProducts.collectionId })
    .from(collectionProducts)
    .where(eq(collectionProducts.productId, productId));
  return [
    catalogTags.product(productId),
    catalogTags.productList,
    ...[product?.brandId, ...extraBrandIds]
      .filter((id): id is string => !!id)
      .map(catalogTags.brand),
    ...cats.map((row) => catalogTags.category(row.id)),
    ...fams.map((row) => catalogTags.family(row.id)),
    ...cols.map((row) => catalogTags.collection(row.id)),
  ];
}

export async function createProduct(
  ctx: CatalogContext,
  input: ProductCreateInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  assertCan(ctx.actor, 'translations.edit');
  return ctx.db.transaction(async (tx) => {
    await assertProductRefs(tx, input.brandId, input.productLineId);
    const translations: TranslationSet = {
      vi: { name: input.translations.vi.name, slug: input.translations.vi.slug, isPublished: true },
      en: null,
    };
    await assertSlugsAvailable(tx, TR.product, null, translations);
    const id = newId();
    const base = {
      brandId: input.brandId,
      productLineId: input.productLineId,
      gender: input.gender,
      concentration: input.concentration,
      status: 'draft' as const,
    };
    await tx.insert(products).values({ id, ...base });
    await writeTranslations(tx, TR.product, id, translations);
    const tags = await finish(ctx, tx, {
      action: 'product.create',
      entityType: 'product',
      entityId: id,
      diff: {
        ...diffRecords(null, base),
        ...prefixDiff('translations.vi.', diffRecords(null, translations.vi)),
      },
      // Drafts are not on the storefront yet; tag only the (empty) product entry.
      tags: [catalogTags.product(id)],
    });
    return { data: { id }, tags };
  });
}

async function assertProductRefs(tx: Tx, brandId: string, productLineId: string | null) {
  const issues: FieldIssue[] = [];
  const brand = await existingIds(tx, brands, brands.id, [brandId], isNull(brands.deletedAt));
  if (brand.size === 0) issues.push({ path: 'details.brandId', code: 'notFound' });
  if (productLineId) {
    const line = await existingIds(
      tx,
      productLines,
      productLines.id,
      [productLineId],
      eq(productLines.brandId, brandId),
    );
    if (line.size === 0) issues.push({ path: 'details.productLineId', code: 'lineBrandMismatch' });
  }
  if (issues.length > 0) throw new DomainError('invalid', issues);
}

type VariantRow = typeof productVariants.$inferSelect;

function variantSnapshot(v: Omit<VariantRow, 'id' | 'productId' | 'createdAt' | 'updatedAt'>) {
  return {
    sku: v.sku,
    barcode: v.barcode,
    sizeMl: v.sizeMl,
    variantType: v.variantType,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    costPrice: v.costPrice,
    weightG: v.weightG,
    isDefault: v.isDefault,
    isActive: v.isActive,
    position: v.position,
  };
}

/**
 * Saves the whole ProductEditor (details, translations, variants, scent, media, compliance)
 * atomically. Optimistic lock on `products.updated_at`; price fields need
 * `products.editPrices` (rejected, not ignored, without it).
 */
export async function saveProduct(
  ctx: CatalogContext,
  input: ProductSaveInput,
): Promise<CommandResult<EntityWriteResult & { updatedAt: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const product = await lockProduct(tx, input.id);
    if (product.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw new DomainError('conflict');
    }

    // Variants: set integrity + price permission.
    const existingVariants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, input.id));
    const existingById = new Map(existingVariants.map((v) => [v.id, v]));
    const issues: FieldIssue[] = [
      ...variantSetIssues(new Set(existingById.keys()), input.variants),
      ...priceFieldViolations(
        new Map<string, VariantPrices>(existingVariants.map((v) => [v.id, v])),
        input.variants,
        can(ctx.actor, 'products.editPrices'),
      ),
    ];
    if (issues.length > 0) {
      const forbidden = issues.some((issue) => issue.code === 'forbiddenField');
      throw new DomainError(forbidden ? 'forbiddenField' : 'invalid', issues);
    }

    // References.
    const { details, scent } = input;
    await assertProductRefs(tx, details.brandId, details.productLineId);
    const refIssues: FieldIssue[] = [];
    const catOk = await existingIds(
      tx,
      categories,
      categories.id,
      details.categoryIds,
      isNull(categories.deletedAt),
    );
    if (catOk.size !== new Set(details.categoryIds).size) {
      refIssues.push({ path: 'details.categoryIds', code: 'notFound' });
    }
    const noteIds = [...new Set(NOTE_LAYERS.flatMap((layer) => scent.notes[layer]))];
    if (
      (await existingIds(tx, fragranceNotes, fragranceNotes.id, noteIds)).size !== noteIds.length
    ) {
      refIssues.push({ path: 'scent.notes', code: 'notFound' });
    }
    const familyIds = scent.families.map((f) => f.familyId);
    if (
      (await existingIds(tx, fragranceFamilies, fragranceFamilies.id, familyIds)).size !==
      familyIds.length
    ) {
      refIssues.push({ path: 'scent.families', code: 'notFound' });
    }
    const mediaIds = input.media.map((m) => m.mediaId);
    if ((await existingIds(tx, media, media.id, mediaIds)).size !== mediaIds.length) {
      refIssues.push({ path: 'media', code: 'notFound' });
    }
    // SKUs are globally unique.
    const skus = input.variants.map((v) => v.sku);
    if (skus.length > 0) {
      const clashes = await tx
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .where(and(inArray(productVariants.sku, skus), ne(productVariants.productId, input.id)));
      const taken = new Set(clashes.map((row) => row.sku));
      input.variants.forEach((v, index) => {
        if (taken.has(v.sku)) refIssues.push({ path: `variants.${index}.sku`, code: 'skuTaken' });
      });
    }
    if (refIssues.length > 0) {
      const skuTaken = refIssues.some((issue) => issue.code === 'skuTaken');
      throw new DomainError(skuTaken ? 'skuTaken' : 'invalid', refIssues);
    }

    // Publishing rules (status itself changes through setProductStatus).
    if (product.status === 'active' && !input.variants.some((v) => v.isActive)) {
      throw new DomainError('invalid', [{ path: 'variants', code: 'activeNeedsVariant' }]);
    }

    // Translations.
    const beforeTranslations = await readTranslations(tx, TR.product, input.id);
    await assertSlugsAvailable(tx, TR.product, input.id, input.translations);
    const translationDiff = diffTranslations(beforeTranslations, input.translations);
    assertTranslationPermission(ctx, translationDiff);

    // Base row.
    const { categoryIds, ...detailColumns } = details;
    const baseAfter = { ...detailColumns, ...input.compliance };
    const baseBefore = Object.fromEntries(
      Object.keys(baseAfter).map((key) => [key, product[key as keyof typeof product]]),
    );
    const [updated] = await tx
      .update(products)
      .set({ ...baseAfter, updatedAt: new Date() })
      .where(eq(products.id, input.id))
      .returning({ updatedAt: products.updatedAt });
    await writeTranslations(tx, TR.product, input.id, input.translations);

    // Variants.
    const variantIds: string[] = [];
    const variantDiff: AuditDiff = {};
    const created: string[] = [];
    try {
      for (const [position, variant] of input.variants.entries()) {
        const { id: variantId, ...values } = variant;
        const row = { ...values, position };
        if (variantId) {
          const previous = existingById.get(variantId)!;
          const diff = diffRecords(variantSnapshot(previous), row);
          if (Object.keys(diff).length > 0) {
            await tx.update(productVariants).set(row).where(eq(productVariants.id, variantId));
            Object.assign(variantDiff, prefixDiff(`variants.${previous.sku}.`, diff));
          }
          variantIds.push(variantId);
        } else {
          const id = newId();
          await tx.insert(productVariants).values({ id, productId: input.id, ...row });
          Object.assign(variantDiff, prefixDiff(`variants.${row.sku}.`, diffRecords(null, row)));
          variantIds.push(id);
          created.push(id);
        }
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('skuTaken');
      throw error;
    }
    await ensureInventoryItems(tx, created);

    // Categories, scent, media.
    const before = await readRelations(tx, input.id);
    await tx.delete(productCategories).where(eq(productCategories.productId, input.id));
    if (categoryIds.length > 0) {
      await tx
        .insert(productCategories)
        .values(
          [...new Set(categoryIds)].map((categoryId) => ({ productId: input.id, categoryId })),
        );
    }
    await tx.delete(productNotes).where(eq(productNotes.productId, input.id));
    const noteRows = NOTE_LAYERS.flatMap((layer) =>
      [...new Set(scent.notes[layer])].map((noteId, position) => ({
        productId: input.id,
        noteId,
        layer,
        position,
      })),
    );
    if (noteRows.length > 0) await tx.insert(productNotes).values(noteRows);
    await tx.delete(productFamilies).where(eq(productFamilies.productId, input.id));
    if (scent.families.length > 0) {
      await tx.insert(productFamilies).values(
        scent.families.map((f) => ({
          productId: input.id,
          familyId: f.familyId,
          isPrimary: f.isPrimary,
        })),
      );
    }
    await tx.delete(productMedia).where(eq(productMedia.productId, input.id));
    for (const [position, item] of input.media.entries()) {
      await tx.insert(productMedia).values({
        productId: input.id,
        mediaId: item.mediaId,
        variantId: item.variantIndex === null ? null : variantIds[item.variantIndex]!,
        position,
      });
      await upsertMediaAlt(tx, item.mediaId, item.alt);
    }
    const after = await readRelations(tx, input.id);

    const slugChanges = detectSlugChanges(
      'product',
      input.id,
      slugStates(beforeTranslations),
      slugStates(input.translations),
    );
    const tags = await finish(ctx, tx, {
      action: 'product.update',
      entityType: 'product',
      entityId: input.id,
      diff: {
        ...diffRecords(baseBefore, baseAfter),
        ...prefixDiff('translations.', translationDiff),
        ...variantDiff,
        ...diffRecords(before, after),
      },
      tags: [
        ...(await productTags(tx, input.id, [product.brandId])),
        ...before.categoryIds.map(catalogTags.category),
        ...before.familyIds.map(catalogTags.family),
        ...variantIds.map(catalogTags.inventory),
      ],
      slugChanges,
    });
    return {
      data: { id: input.id, slugChanges, updatedAt: updated!.updatedAt.toISOString() },
      tags,
    };
  });
}

async function readRelations(tx: Tx, productId: string) {
  const cats = await tx
    .select({ id: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.productId, productId));
  const notes = await tx
    .select({ id: productNotes.noteId, layer: productNotes.layer, position: productNotes.position })
    .from(productNotes)
    .where(eq(productNotes.productId, productId));
  const fams = await tx
    .select({ id: productFamilies.familyId, isPrimary: productFamilies.isPrimary })
    .from(productFamilies)
    .where(eq(productFamilies.productId, productId));
  const mediaRows = await tx
    .select({
      id: productMedia.mediaId,
      position: productMedia.position,
      variantId: productMedia.variantId,
    })
    .from(productMedia)
    .where(eq(productMedia.productId, productId));
  const sortedNotes = notes.sort(
    (a, b) => a.layer.localeCompare(b.layer) || a.position - b.position,
  );
  return {
    categoryIds: cats.map((row) => row.id).sort(),
    notes: sortedNotes.map((row) => `${row.layer}:${row.id}`),
    familyIds: fams.map((row) => row.id).sort(),
    primaryFamilyId: fams.find((row) => row.isPrimary)?.id ?? null,
    media: mediaRows
      .sort((a, b) => a.position - b.position)
      .map((row) => (row.variantId ? `${row.id}@${row.variantId}` : row.id)),
  };
}

async function upsertMediaAlt(tx: Tx, mediaId: string, alt: { vi: string; en: string | null }) {
  await tx
    .insert(mediaTranslations)
    .values({ mediaId, locale: 'vi', alt: alt.vi })
    .onConflictDoUpdate({
      target: [mediaTranslations.mediaId, mediaTranslations.locale],
      set: { alt: alt.vi },
    });
  if (alt.en) {
    await tx
      .insert(mediaTranslations)
      .values({ mediaId, locale: 'en', alt: alt.en })
      .onConflictDoUpdate({
        target: [mediaTranslations.mediaId, mediaTranslations.locale],
        set: { alt: alt.en },
      });
  } else {
    await tx
      .delete(mediaTranslations)
      .where(and(eq(mediaTranslations.mediaId, mediaId), eq(mediaTranslations.locale, 'en')));
  }
}

export async function setProductStatus(
  ctx: CatalogContext,
  input: { id: string; status: 'draft' | 'active' | 'archived' },
): Promise<CommandResult<{ id: string; updatedAt: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const product = await lockProduct(tx, input.id);
    if (input.status === 'active') {
      const [active] = await tx
        .select({ n: count() })
        .from(productVariants)
        .where(and(eq(productVariants.productId, input.id), eq(productVariants.isActive, true)));
      if ((active?.n ?? 0) === 0) {
        throw new DomainError('invalid', [{ path: 'status', code: 'activeNeedsVariant' }]);
      }
      const translations = await readTranslations(tx, TR.product, input.id);
      if (!translations.vi?.isPublished) {
        throw new DomainError('invalid', [{ path: 'status', code: 'activeNeedsVietnamese' }]);
      }
    }
    const publishedAt =
      input.status === 'active' ? (product.publishedAt ?? new Date()) : product.publishedAt;
    const [updated] = await tx
      .update(products)
      .set({ status: input.status, publishedAt, updatedAt: new Date() })
      .where(eq(products.id, input.id))
      .returning({ updatedAt: products.updatedAt });
    const tags = await finish(ctx, tx, {
      action: 'product.status',
      entityType: 'product',
      entityId: input.id,
      diff: diffRecords({ status: product.status }, { status: input.status }),
      tags: await productTags(tx, input.id),
    });
    return { data: { id: input.id, updatedAt: updated!.updatedAt.toISOString() }, tags };
  });
}

/**
 * Copies a product as a draft: unpublished translations with `-copy` slugs, inactive variants
 * with `-COPY` SKUs (prices are copied, not set, so content editors may duplicate), same
 * scent, categories and images, empty stock.
 */
export async function duplicateProduct(
  ctx: CatalogContext,
  input: { id: string },
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const source = await lockProduct(tx, input.id);
    const id = newId();
    const copy = omit(source, ['id', 'createdAt', 'updatedAt', 'ratingAvg', 'ratingCount']);
    await tx
      .insert(products)
      .values({ ...copy, id, status: 'draft', publishedAt: null, isFeatured: false });

    const translations = await tx
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, input.id));
    for (const translation of translations) {
      const base = `${translation.slug}-copy`;
      const taken = await tx
        .select({ slug: productTranslations.slug })
        .from(productTranslations)
        .where(
          and(
            eq(productTranslations.locale, translation.locale),
            like(productTranslations.slug, `${base}%`),
          ),
        );
      const values = omit(translation, ['productId', 'searchVector', 'createdAt', 'updatedAt']);
      await tx.insert(productTranslations).values({
        ...values,
        productId: id,
        slug: uniqueSlug(base, new Set(taken.map((row) => row.slug))),
        isPublished: false,
      });
    }

    const variants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, input.id));
    const newVariantIds = new Map<string, string>();
    for (const variant of variants) {
      const base = `${variant.sku}-COPY`;
      const taken = await tx
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .where(or(eq(productVariants.sku, base), like(productVariants.sku, `${base}-%`)));
      const takenSet = new Set(taken.map((row) => row.sku));
      let sku = base;
      for (let n = 2; takenSet.has(sku); n += 1) sku = `${base}-${n}`;
      const variantId = newId();
      newVariantIds.set(variant.id, variantId);
      const values = omit(variant, ['id', 'productId', 'createdAt', 'updatedAt']);
      await tx
        .insert(productVariants)
        .values({ ...values, id: variantId, productId: id, sku, isActive: false });
    }
    await ensureInventoryItems(tx, [...newVariantIds.values()]);

    await tx.execute(sql`
      insert into product_categories (product_id, category_id)
      select ${id}, category_id from product_categories where product_id = ${input.id}`);
    await tx.execute(sql`
      insert into product_families (product_id, family_id, is_primary)
      select ${id}, family_id, is_primary from product_families where product_id = ${input.id}`);
    await tx.execute(sql`
      insert into product_notes (product_id, note_id, layer, position)
      select ${id}, note_id, layer, position from product_notes where product_id = ${input.id}`);
    const mediaRows = await tx
      .select()
      .from(productMedia)
      .where(eq(productMedia.productId, input.id));
    if (mediaRows.length > 0) {
      await tx.insert(productMedia).values(
        mediaRows.map((row) => ({
          productId: id,
          mediaId: row.mediaId,
          variantId: row.variantId ? (newVariantIds.get(row.variantId) ?? null) : null,
          position: row.position,
        })),
      );
    }

    const tags = await finish(ctx, tx, {
      action: 'product.duplicate',
      entityType: 'product',
      entityId: id,
      diff: { sourceId: { from: null, to: input.id } },
      tags: [catalogTags.product(id)],
    });
    return { data: { id }, tags };
  });
}

/** Soft delete (ARCHITECTURE.md §6.1): hidden everywhere, history kept. */
export async function deleteProduct(
  ctx: CatalogContext,
  input: { id: string },
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'products.editContent');
  return ctx.db.transaction(async (tx) => {
    const product = await lockProduct(tx, input.id);
    const tags = await productTags(tx, input.id);
    await tx
      .update(products)
      .set({ deletedAt: new Date(), status: 'archived' })
      .where(eq(products.id, input.id));
    const done = await finish(ctx, tx, {
      action: 'product.delete',
      entityType: 'product',
      entityId: input.id,
      diff: diffRecords(
        { status: product.status, deleted: false },
        { status: 'archived', deleted: true },
      ),
      tags,
    });
    return { data: { id: input.id }, tags: done };
  });
}
