'use server';

import 'server-only';

import {
  editOrder,
  editVariantSearchSchema,
  orderEditSchema,
  previewOrderEdit,
  searchOrderEditVariants,
} from '@/server/modules/order';

import { runAdminAction } from './run';

/*
 * Order edits before shipment (§3.4 step 8, §11.2): `orders.editBeforeShipping` (Owner,
 * Manager, Staff). The shipping fee override additionally needs Manager rights, enforced in
 * the command. Preview and search never write, so they skip the page refresh.
 */

export async function previewOrderEditAction(raw: unknown) {
  return runAdminAction(orderEditSchema, raw, 'orders.editBeforeShipping', previewOrderEdit, {
    refresh: false,
  });
}

export async function editOrderAction(raw: unknown) {
  return runAdminAction(orderEditSchema, raw, 'orders.editBeforeShipping', editOrder);
}

export async function searchOrderEditVariantsAction(raw: unknown) {
  return runAdminAction(
    editVariantSearchSchema,
    raw,
    'orders.editBeforeShipping',
    searchOrderEditVariants,
    { refresh: false },
  );
}
