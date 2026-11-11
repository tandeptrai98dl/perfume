import { and, asc, eq, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/server/db/client';
import { shippingRates, shippingRateTranslations, shippingZones } from '@/server/db/schema';

/**
 * Shipping quotes (§10.4): zone = first zone (by position) containing the province; rates match
 * the parcel weight. Read API shared by cart (free-shipping progress) and checkout. Admin
 * zone/rate management lives in the admin stream (`commands.ts`).
 */

export type ShippingQuote = {
  rateId: string;
  name: string;
  fee: number;
  freeOverSubtotal: number | null;
  etaMinDays: number;
  etaMaxDays: number;
};

type Executor = Pick<Database, 'select'>;

export async function quoteShipping(
  db: Executor,
  input: { provinceCode: string; weightG: number; locale: Locale },
): Promise<ShippingQuote[]> {
  const [zone] = await db
    .select({ id: shippingZones.id })
    .from(shippingZones)
    .where(sql`${input.provinceCode} = any(${shippingZones.provinceCodes})`)
    .orderBy(asc(shippingZones.position))
    .limit(1);
  if (!zone) return [];
  return db
    .select({
      rateId: shippingRates.id,
      name: sql<string>`coalesce(${shippingRateTranslations.name}, '')`,
      fee: shippingRates.fee,
      freeOverSubtotal: shippingRates.freeOverSubtotal,
      etaMinDays: shippingRates.etaMinDays,
      etaMaxDays: shippingRates.etaMaxDays,
    })
    .from(shippingRates)
    .leftJoin(
      shippingRateTranslations,
      and(
        eq(shippingRateTranslations.rateId, shippingRates.id),
        eq(shippingRateTranslations.locale, input.locale),
      ),
    )
    .where(
      and(
        eq(shippingRates.zoneId, zone.id),
        eq(shippingRates.isActive, true),
        sql`${shippingRates.minWeightG} <= ${input.weightG}`,
        sql`(${shippingRates.maxWeightG} is null or ${shippingRates.maxWeightG} >= ${input.weightG})`,
      ),
    )
    .orderBy(asc(shippingRates.position), asc(shippingRates.fee));
}

/** Rate chosen at checkout, re-validated on the server (province + weight must still match). */
export async function getShippingRateForOrder(
  db: Executor,
  input: { rateId: string; provinceCode: string; weightG: number; locale: Locale },
): Promise<ShippingQuote | null> {
  const quotes = await quoteShipping(db, input);
  return quotes.find((quote) => quote.rateId === input.rateId) ?? null;
}

/**
 * Lowest "free over" threshold among active rates, for the cart's free-shipping progress bar
 * before an address is known. Null when no rate offers free shipping.
 */
export async function getFreeShippingThreshold(db: Executor): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<string | null>`min(${shippingRates.freeOverSubtotal})` })
    .from(shippingRates)
    .where(eq(shippingRates.isActive, true));
  return row?.min == null ? null : Number(row.min);
}

// Admin (admin-orders stream): shipments, zone/rate management and admin reads.
export {
  createShipment,
  deleteShippingRate,
  deleteShippingZone,
  saveShippingRate,
  saveShippingZone,
  setShippingRateActive,
  SHIPPING_PERMISSION,
  shippingTags,
  updateLatestShipmentStatus,
  type ShipmentStatus,
} from './commands';
export {
  latestShipmentsForOrders,
  listProvinceOptions,
  listShipmentsForOrder,
  listShippingZonesForAdmin,
  type AdminShipment,
  type AdminShippingRate,
  type AdminShippingZone,
  type ProvinceOption,
} from './admin-queries';
export {
  shippingEntityIdSchema,
  shippingRateActiveSchema,
  shippingRateSchema,
  shippingZoneSchema,
  type ShippingEntityIdInput,
  type ShippingRateActiveInput,
  type ShippingRateInput,
  type ShippingZoneInput,
} from './admin-schemas';
