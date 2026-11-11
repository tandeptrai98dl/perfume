'use server';

import 'server-only';

import {
  addOrderNote,
  bulkConfirmOrders,
  bulkOrdersSchema,
  cancelOrder,
  cancelOrderSchema,
  changeOrderStatus,
  orderNoteSchema,
  orderTransitionSchema,
  shipOrder,
  shipOrderSchema,
} from '@/server/modules/order';

import { runAdminAction } from './run';

/*
 * Orders (§5.2 /admin/orders): `orders.process` (Owner, Manager, Staff). Cancelling an order
 * that is confirmed or holds money additionally needs `orders.cancelPaid`, enforced by the
 * state machine actor mapping inside the command.
 */

export async function changeOrderStatusAction(raw: unknown) {
  return runAdminAction(orderTransitionSchema, raw, 'orders.process', changeOrderStatus);
}

export async function cancelOrderAction(raw: unknown) {
  return runAdminAction(cancelOrderSchema, raw, 'orders.process', cancelOrder);
}

export async function shipOrderAction(raw: unknown) {
  return runAdminAction(shipOrderSchema, raw, 'orders.process', shipOrder);
}

export async function addOrderNoteAction(raw: unknown) {
  return runAdminAction(orderNoteSchema, raw, 'orders.process', addOrderNote);
}

export async function bulkConfirmOrdersAction(raw: unknown) {
  return runAdminAction(bulkOrdersSchema, raw, 'orders.process', bulkConfirmOrders);
}
