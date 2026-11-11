'use server';

import 'server-only';

import { z } from 'zod';

import {
  adminSchemas,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteFamily,
  deleteNote,
  deleteProductLine,
  saveBrand,
  saveCategory,
  saveCollection,
  saveFamily,
  saveNote,
  saveProductLine,
  setCollectionProducts,
} from '@/server/modules/catalog';

import { runAdminAction } from './run';

/*
 * Catalogue data (§5.2 /admin/catalog/*). Each action: Zod → requirePermission → command.
 * `id: null` creates, a UUID updates.
 */

const { idSchema } = adminSchemas;
const target = z.union([idSchema, z.null()]);
const withId = <S extends z.ZodType>(input: S) => z.object({ id: target, input });

export async function saveBrandAction(raw: unknown) {
  return runAdminAction(
    withId(adminSchemas.brandInputSchema),
    raw,
    'products.editContent',
    (ctx, { id, input }) => saveBrand(ctx, id, input),
  );
}

export async function deleteBrandAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.idInputSchema,
    raw,
    'products.editContent',
    (ctx, { id }) => deleteBrand(ctx, id),
    { refresh: false },
  );
}

export async function saveProductLineAction(raw: unknown) {
  return runAdminAction(
    withId(adminSchemas.productLineInputSchema),
    raw,
    'products.editContent',
    (ctx, { id, input }) => saveProductLine(ctx, id, input),
  );
}

export async function deleteProductLineAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.idInputSchema,
    raw,
    'products.editContent',
    // Deleted from the list page, which must re-render.
    (ctx, { id }) => deleteProductLine(ctx, id),
  );
}

export async function saveCategoryAction(raw: unknown) {
  return runAdminAction(
    withId(adminSchemas.categoryInputSchema),
    raw,
    'products.editContent',
    (ctx, { id, input }) => saveCategory(ctx, id, input),
  );
}

export async function deleteCategoryAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.idInputSchema,
    raw,
    'products.editContent',
    (ctx, { id }) => deleteCategory(ctx, id),
    { refresh: false },
  );
}

export async function saveCollectionAction(raw: unknown) {
  return runAdminAction(
    withId(adminSchemas.collectionInputSchema),
    raw,
    'products.editContent',
    (ctx, { id, input }) => saveCollection(ctx, id, input),
  );
}

export async function setCollectionProductsAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.collectionProductsInputSchema,
    raw,
    'products.editContent',
    (ctx, input) => setCollectionProducts(ctx, input),
  );
}

export async function deleteCollectionAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.idInputSchema,
    raw,
    'products.editContent',
    (ctx, { id }) => deleteCollection(ctx, id),
    { refresh: false },
  );
}

export async function saveTaxonomyAction(raw: unknown) {
  return runAdminAction(
    z.object({
      kind: z.enum(['family', 'note']),
      id: target,
      input: adminSchemas.taxonomyInputSchema,
    }),
    raw,
    'products.editContent',
    (ctx, { kind, id, input }) =>
      kind === 'family' ? saveFamily(ctx, id, input) : saveNote(ctx, id, input),
  );
}

export async function deleteTaxonomyAction(raw: unknown) {
  return runAdminAction(
    z.object({ kind: z.enum(['family', 'note']), id: idSchema }),
    raw,
    'products.editContent',
    (ctx, { kind, id }) => (kind === 'family' ? deleteFamily(ctx, id) : deleteNote(ctx, id)),
    { refresh: false },
  );
}
