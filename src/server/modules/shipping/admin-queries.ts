import { asc, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  provinces,
  shipments,
  shippingRates,
  shippingRateTranslations,
  shippingZones,
} from '@/server/db/schema';

/* Admin read side for shipping: zones with their rates, provinces, an order's shipments. */

type Reader = Pick<Database, 'select'>;

export type AdminShippingRate = {
  id: string;
  zoneId: string;
  names: { vi: string; en: string };
  minWeightG: number;
  maxWeightG: number | null;
  fee: number;
  freeOverSubtotal: number | null;
  etaMinDays: number;
  etaMaxDays: number;
  isActive: boolean;
  position: number;
};

export type AdminShippingZone = {
  id: string;
  name: string;
  provinceCodes: string[];
  position: number;
  rates: AdminShippingRate[];
};

export async function listShippingZonesForAdmin(db: Reader): Promise<AdminShippingZone[]> {
  const zones = await db
    .select()
    .from(shippingZones)
    .orderBy(asc(shippingZones.position), asc(shippingZones.createdAt));
  if (zones.length === 0) return [];
  const rates = await db
    .select()
    .from(shippingRates)
    .where(
      inArray(
        shippingRates.zoneId,
        zones.map((zone) => zone.id),
      ),
    )
    .orderBy(asc(shippingRates.position), asc(shippingRates.minWeightG), asc(shippingRates.fee));
  const names = rates.length
    ? await db
        .select()
        .from(shippingRateTranslations)
        .where(
          inArray(
            shippingRateTranslations.rateId,
            rates.map((rate) => rate.id),
          ),
        )
    : [];
  const nameOf = (rateId: string, locale: 'vi' | 'en') =>
    names.find((row) => row.rateId === rateId && row.locale === locale)?.name ?? '';
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    provinceCodes: zone.provinceCodes,
    position: zone.position,
    rates: rates
      .filter((rate) => rate.zoneId === zone.id)
      .map((rate) => ({
        id: rate.id,
        zoneId: rate.zoneId,
        names: { vi: nameOf(rate.id, 'vi'), en: nameOf(rate.id, 'en') },
        minWeightG: rate.minWeightG,
        maxWeightG: rate.maxWeightG,
        fee: rate.fee,
        freeOverSubtotal: rate.freeOverSubtotal,
        etaMinDays: rate.etaMinDays,
        etaMaxDays: rate.etaMaxDays,
        isActive: rate.isActive,
        position: rate.position,
      })),
  }));
}

export type ProvinceOption = { code: string; name: string };

/** The 34 post-2025 provinces (seeded), alphabetical for pickers and filters. */
export async function listProvinceOptions(db: Reader): Promise<ProvinceOption[]> {
  return db
    .select({ code: provinces.code, name: provinces.name })
    .from(provinces)
    .orderBy(asc(provinces.nameAscii));
}

export type AdminShipment = {
  id: string;
  carrier: string;
  trackingCode: string;
  status: string;
  codAmount: number;
  feeActual: number | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

export async function listShipmentsForOrder(db: Reader, orderId: string): Promise<AdminShipment[]> {
  return db
    .select({
      id: shipments.id,
      carrier: shipments.carrier,
      trackingCode: shipments.trackingCode,
      status: shipments.status,
      codAmount: shipments.codAmount,
      feeActual: shipments.feeActual,
      shippedAt: shipments.shippedAt,
      deliveredAt: shipments.deliveredAt,
      createdAt: shipments.createdAt,
    })
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .orderBy(desc(shipments.createdAt));
}

/** Latest shipment per order, for printed delivery slips. */
export async function latestShipmentsForOrders(
  db: Reader,
  orderIds: readonly string[],
): Promise<Map<string, AdminShipment>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: shipments.orderId,
      id: shipments.id,
      carrier: shipments.carrier,
      trackingCode: shipments.trackingCode,
      status: shipments.status,
      codAmount: shipments.codAmount,
      feeActual: shipments.feeActual,
      shippedAt: shipments.shippedAt,
      deliveredAt: shipments.deliveredAt,
      createdAt: shipments.createdAt,
    })
    .from(shipments)
    .where(inArray(shipments.orderId, [...orderIds]))
    .orderBy(desc(shipments.createdAt));
  const out = new Map<string, AdminShipment>();
  for (const { orderId, ...shipment } of rows) if (!out.has(orderId)) out.set(orderId, shipment);
  return out;
}
