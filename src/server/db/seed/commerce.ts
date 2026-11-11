import { sql } from 'drizzle-orm';

import type { Database } from '../client';
import { coupons, shippingRates, shippingRateTranslations, shippingZones } from '../schema';

/**
 * Shipping defaults for a fresh environment (idempotent): one nationwide zone with a standard
 * and an express rate. Staff refine zones and fees in /admin/shipping.
 */
export async function seedShipping(db: Database): Promise<{ skipped: boolean; rates: number }> {
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(shippingZones);
  if ((existing?.n ?? 0) > 0) return { skipped: true, rates: 0 };

  const provinceRows = await db.execute<{ code: string }>(
    sql`select code from provinces order by code`,
  );
  const [zone] = await db
    .insert(shippingZones)
    .values({ name: 'Toàn quốc', provinceCodes: provinceRows.rows.map((r) => r.code) })
    .returning({ id: shippingZones.id });

  const rates = [
    {
      fee: 30_000,
      freeOverSubtotal: 2_000_000,
      etaMinDays: 2,
      etaMaxDays: 5,
      vi: 'Giao tiêu chuẩn',
      en: 'Standard delivery',
      position: 0,
    },
    {
      fee: 50_000,
      freeOverSubtotal: null,
      etaMinDays: 1,
      etaMaxDays: 2,
      vi: 'Giao nhanh',
      en: 'Express delivery',
      position: 1,
    },
  ];
  for (const rate of rates) {
    const [row] = await db
      .insert(shippingRates)
      .values({
        zoneId: zone!.id,
        fee: rate.fee,
        freeOverSubtotal: rate.freeOverSubtotal,
        etaMinDays: rate.etaMinDays,
        etaMaxDays: rate.etaMaxDays,
        position: rate.position,
      })
      .returning({ id: shippingRates.id });
    await db.insert(shippingRateTranslations).values([
      { rateId: row!.id, locale: 'vi', name: rate.vi },
      { rateId: row!.id, locale: 'en', name: rate.en },
    ]);
  }
  return { skipped: false, rates: rates.length };
}

/** Demo coupons (fictional): 10% welcome (max 200,000 ₫) and free shipping over 1,000,000 ₫. */
export async function seedDemoCoupons(db: Database): Promise<number> {
  const inserted = await db
    .insert(coupons)
    .values([
      {
        code: 'WELCOME10',
        type: 'percent',
        value: 10,
        maxDiscount: 200_000,
        perCustomerLimit: 1,
        note: 'Demo',
      },
      { code: 'FREESHIP', type: 'free_shipping', value: 0, minSubtotal: 1_000_000, note: 'Demo' },
    ])
    .onConflictDoNothing()
    .returning({ id: coupons.id });
  return inserted.length;
}
