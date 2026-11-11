'use server';

import 'server-only';

import { z } from 'zod';

import { getDb } from '@/server/db/client';
import { requirePermission, AuthorizationError } from '@/server/auth/guards';
import {
  adminSchemas,
  createProduct,
  deleteProduct,
  duplicateProduct,
  saveProduct,
  searchProductOptions,
  setProductStatus,
} from '@/server/modules/catalog';

import { runAdminAction, type ActionResult } from './run';

/*
 * Products (§5.2 /admin/products). Content needs `products.editContent`; the command
 * additionally rejects price changes without `products.editPrices`.
 */

export async function createProductAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.productCreateSchema,
    raw,
    'products.editContent',
    createProduct,
  );
}

export async function saveProductAction(raw: unknown) {
  return runAdminAction(adminSchemas.productSaveSchema, raw, 'products.editContent', saveProduct);
}

export async function setProductStatusAction(raw: unknown) {
  return runAdminAction(
    adminSchemas.productStatusSchema,
    raw,
    'products.editContent',
    setProductStatus,
  );
}

export async function duplicateProductAction(raw: unknown) {
  return runAdminAction(adminSchemas.idInputSchema, raw, 'products.editContent', duplicateProduct);
}

export async function deleteProductAction(raw: unknown) {
  return runAdminAction(adminSchemas.idInputSchema, raw, 'products.editContent', deleteProduct);
}

export type ProductOption = { id: string; name: string; brandName: string; status: string };

/** Product picker (collections). Read-only, but still validated and permission-checked. */
export async function searchProductsAction(raw: unknown): Promise<ActionResult<ProductOption[]>> {
  const parsed = z.object({ q: z.string().trim().max(100) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: [] };
  try {
    await requirePermission('products.editContent');
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: 'unauthorized', fieldErrors: [] };
    }
    throw error;
  }
  return { ok: true, data: await searchProductOptions(getDb(), parsed.data.q) };
}
