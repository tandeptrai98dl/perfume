'use server';

import 'server-only';

import { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { searchProductOptions } from '@/server/modules/catalog';
import {
  couponActiveSchema,
  couponSchema,
  saveCoupon,
  setCouponActive,
} from '@/server/modules/promotion';

import { runAdminAction, type ActionResult } from './run';

/* Coupons (§5.2 /admin/promotions/coupons): `coupons.manage` (Owner, Manager). */

export async function saveCouponAction(raw: unknown) {
  return runAdminAction(couponSchema, raw, 'coupons.manage', saveCoupon);
}

export async function setCouponActiveAction(raw: unknown) {
  return runAdminAction(couponActiveSchema, raw, 'coupons.manage', setCouponActive);
}

export type CouponProductOption = { id: string; name: string; brandName: string };

/** Product picker of the coupon scope. Read-only, but still validated and permission-checked. */
export async function searchCouponProductsAction(
  raw: unknown,
): Promise<ActionResult<CouponProductOption[]>> {
  const parsed = z.object({ q: z.string().trim().max(100) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation', fieldErrors: [] };
  try {
    await requirePermission('coupons.manage');
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: 'unauthorized', fieldErrors: [] };
    }
    throw error;
  }
  const rows = await searchProductOptions(getDb(), parsed.data.q, 10);
  return { ok: true, data: rows.map(({ id, name, brandName }) => ({ id, name, brandName })) };
}
