'use server';

import 'server-only';

import {
  adjustStock,
  lowStockThresholdSchema,
  setLowStockThreshold,
  stockAdjustSchema,
} from '@/server/modules/inventory';

import { runAdminAction } from './run';

/** Inventory (§5.2 /admin/inventory): `inventory.adjust` (owner, manager, staff). */

export async function adjustStockAction(raw: unknown) {
  return runAdminAction(stockAdjustSchema, raw, 'inventory.adjust', adjustStock);
}

export async function setLowStockThresholdAction(raw: unknown) {
  return runAdminAction(lowStockThresholdSchema, raw, 'inventory.adjust', setLowStockThreshold);
}
