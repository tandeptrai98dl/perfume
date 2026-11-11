'use server';

import 'server-only';

import {
  deleteShippingRate,
  deleteShippingZone,
  saveShippingRate,
  saveShippingZone,
  setShippingRateActive,
  SHIPPING_PERMISSION,
  shippingEntityIdSchema,
  shippingRateActiveSchema,
  shippingRateSchema,
  shippingZoneSchema,
} from '@/server/modules/shipping';

import { runAdminAction } from './run';

/* Shipping zones and rates (§5.2 /admin/shipping): checkout prices, so `settings.manage`. */

export async function saveShippingZoneAction(raw: unknown) {
  return runAdminAction(shippingZoneSchema, raw, SHIPPING_PERMISSION, saveShippingZone);
}

export async function deleteShippingZoneAction(raw: unknown) {
  return runAdminAction(shippingEntityIdSchema, raw, SHIPPING_PERMISSION, deleteShippingZone);
}

export async function saveShippingRateAction(raw: unknown) {
  return runAdminAction(shippingRateSchema, raw, SHIPPING_PERMISSION, saveShippingRate);
}

export async function setShippingRateActiveAction(raw: unknown) {
  return runAdminAction(shippingRateActiveSchema, raw, SHIPPING_PERMISSION, setShippingRateActive);
}

export async function deleteShippingRateAction(raw: unknown) {
  return runAdminAction(shippingEntityIdSchema, raw, SHIPPING_PERMISSION, deleteShippingRate);
}
