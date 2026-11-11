import { eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import { auditLogs, brands, coupons, orders, shippingZones, users } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { generateOrderCode } from '@/server/modules/order';
import {
  couponSchema,
  findCoupon,
  getCouponForEdit,
  listCoupons,
  redeemCoupon,
  saveCoupon,
  setCouponActive,
} from '@/server/modules/promotion';
import {
  deleteShippingZone,
  listShippingZonesForAdmin,
  quoteShipping,
  saveShippingRate,
  saveShippingZone,
  setShippingRateActive,
  shippingRateSchema,
  shippingZoneSchema,
} from '@/server/modules/shipping';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
const actorIds = {} as Record<StaffRole, string>;

const ctx = (role: StaffRole): CommandContext => ({
  db,
  boss,
  actor: { id: actorIds[role], role },
  ip: null,
});

const listQuery = { q: '', page: 1, pageSize: 50, sort: '', dir: 'desc' as const };

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);
  for (const role of ['owner', 'manager', 'staff', 'editor'] as const) {
    const id = newId();
    actorIds[role] = id;
    await db.insert(users).values({ id, name: role, email: `${role}@perfume.test`, role });
  }
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('coupons', () => {
  it('creates, edits and toggles coupons with usage statistics', async () => {
    const [brand] = await db.select({ id: brands.id, name: brands.name }).from(brands).limit(1);
    const input = couponSchema.parse({
      code: ' tet2027 ',
      type: 'percent',
      value: 15,
      maxDiscount: 300_000,
      minSubtotal: 1_000_000,
      startsAt: '2026-01-01T00:00:00+07:00',
      endsAt: '2099-01-01T00:00:00+07:00',
      usageLimit: 100,
      perCustomerLimit: 1,
      scope: { brandIds: [brand!.id] },
      excludeSaleItems: true,
    });
    expect(input.code).toBe('TET2027');

    await expect(saveCoupon(ctx('staff'), input)).rejects.toMatchObject({ code: 'forbidden' });
    const created = await saveCoupon(ctx('manager'), input);
    expect(created.tags).toEqual(['promotion:coupons']);

    await expect(saveCoupon(ctx('owner'), { ...input, value: 10 })).rejects.toMatchObject({
      fieldErrors: [{ path: 'code', code: 'couponCodeTaken' }],
    });

    // The storefront lookup sees it.
    const found = await findCoupon(db, 'tet2027');
    expect(found.ok && found.coupon).toMatchObject({
      type: 'percent',
      value: 15,
      scope: { brandIds: [brand!.id] },
    });

    // A redemption at checkout feeds the usage statistics.
    const [order] = await db
      .insert(orders)
      .values({
        code: generateOrderCode(),
        email: 'a@example.com',
        phone: '0911222333',
        customerName: 'A',
        locale: 'vi',
        status: 'pending',
        paymentMethod: 'vnpay',
        subtotal: 2_000_000,
        discountTotal: 300_000,
        total: 1_700_000,
        couponCode: 'TET2027',
      })
      .returning();
    await db.transaction((tx) =>
      redeemCoupon(tx, {
        couponId: created.data.id,
        orderId: order!.id,
        userId: null,
        phone: '0911222333',
        email: 'a@example.com',
        amount: 300_000,
      }),
    );

    const list = await listCoupons(db, { ...listQuery, q: 'tet' });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      code: 'TET2027',
      usedCount: 1,
      state: 'active',
      usage: { redemptions: 1, discountTotal: 300_000 },
    });
    const detail = await getCouponForEdit(db, created.data.id);
    expect(detail?.usage).toMatchObject({
      redemptions: 1,
      discountTotal: 300_000,
      uniqueCustomers: 1,
    });
    expect(detail?.scopeLabels.brands).toEqual([brand]);
    expect(detail?.recentRedemptions[0]).toMatchObject({ orderCode: order!.code, amount: 300_000 });

    // Used coupons keep their code; other fields stay editable.
    await expect(
      saveCoupon(ctx('owner'), { ...input, id: created.data.id, code: 'TET2028' }),
    ).rejects.toMatchObject({ fieldErrors: [{ path: 'code', code: 'couponUsed' }] });
    await saveCoupon(ctx('owner'), { ...input, id: created.data.id, value: 20 });
    expect((await getCouponForEdit(db, created.data.id))?.value).toBe(20);

    await setCouponActive(ctx('owner'), { id: created.data.id, isActive: false });
    expect(await findCoupon(db, 'TET2027')).toEqual({ ok: false, reason: 'inactive' });
    expect((await listCoupons(db, { ...listQuery, q: 'TET2027' })).rows[0]?.state).toBe('inactive');

    const audits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.data.id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'coupon.create',
      'coupon.deactivate',
      'coupon.update',
    ]);
  });

  it('validates coupon rules', () => {
    const base = { code: 'SHIP', type: 'free_shipping', value: 50 };
    expect(couponSchema.parse(base)).toMatchObject({ value: 0, maxDiscount: null });
    const percent = couponSchema.safeParse({ code: 'BIG', type: 'percent', value: 120 });
    expect(percent.success).toBe(false);
    const dates = couponSchema.safeParse({
      code: 'DATES',
      type: 'fixed',
      value: 100_000,
      startsAt: '2027-02-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
    });
    expect(dates.error?.issues.map((i) => i.message)).toEqual(['endBeforeStart']);
    expect(couponSchema.safeParse({ code: 'a b', type: 'fixed', value: 1 }).success).toBe(false);
  });

  it('does not count used coupons twice when listing', async () => {
    const [row] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME10'));
    const list = await listCoupons(db, { ...listQuery, q: 'WELCOME10' });
    expect(list.rows[0]?.usage.redemptions).toBe(row!.usedCount);
  });
});

describe('shipping zones and rates', () => {
  it('drives checkout quotes from admin-managed zones and rates', async () => {
    const [nationwide] = await db.select().from(shippingZones);
    await expect(
      saveShippingZone(
        ctx('manager'),
        shippingZoneSchema.parse({ name: 'X', provinceCodes: ['01'] }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Push the nationwide zone back so the new inner-city zone wins for Hà Nội.
    await saveShippingZone(
      ctx('owner'),
      shippingZoneSchema.parse({
        id: nationwide!.id,
        name: nationwide!.name,
        provinceCodes: nationwide!.provinceCodes,
        position: 10,
      }),
    );
    const zone = await saveShippingZone(
      ctx('owner'),
      shippingZoneSchema.parse({ name: 'Hà Nội', provinceCodes: ['01', '01'], position: 0 }),
    );
    await expect(
      saveShippingZone(
        ctx('owner'),
        shippingZoneSchema.parse({ name: 'Y', provinceCodes: ['99'] }),
      ),
    ).rejects.toMatchObject({ fieldErrors: [{ path: 'provinceCodes', code: 'invalid' }] });

    expect(await quoteShipping(db, { provinceCode: '01', weightG: 300, locale: 'vi' })).toEqual([]);

    const rate = await saveShippingRate(
      ctx('owner'),
      shippingRateSchema.parse({
        zoneId: zone.data.id,
        names: { vi: 'Giao nội thành', en: 'Inner-city delivery' },
        minWeightG: 0,
        maxWeightG: 2000,
        fee: 20_000,
        freeOverSubtotal: 1_500_000,
        etaMinDays: 0,
        etaMaxDays: 1,
      }),
    );
    expect(rate.tags).toEqual(['shipping:rates']);
    const quotes = await quoteShipping(db, { provinceCode: '01', weightG: 300, locale: 'en' });
    expect(quotes).toEqual([
      {
        rateId: rate.data.id,
        name: 'Inner-city delivery',
        fee: 20_000,
        freeOverSubtotal: 1_500_000,
        etaMinDays: 0,
        etaMaxDays: 1,
      },
    ]);
    // Heavier parcels fall outside the band.
    expect(await quoteShipping(db, { provinceCode: '01', weightG: 2500, locale: 'vi' })).toEqual(
      [],
    );
    // Other provinces still use the nationwide zone.
    expect(
      (await quoteShipping(db, { provinceCode: '79', weightG: 300, locale: 'vi' })).length,
    ).toBe(2);

    await saveShippingRate(
      ctx('owner'),
      shippingRateSchema.parse({
        id: rate.data.id,
        zoneId: zone.data.id,
        names: { vi: 'Giao nội thành 2h', en: 'Inner-city 2h' },
        minWeightG: 0,
        maxWeightG: 3000,
        fee: 25_000,
        etaMinDays: 0,
        etaMaxDays: 1,
      }),
    );
    const updated = await quoteShipping(db, { provinceCode: '01', weightG: 2500, locale: 'vi' });
    expect(updated.map((q) => [q.name, q.fee, q.freeOverSubtotal])).toEqual([
      ['Giao nội thành 2h', 25_000, null],
    ]);

    await setShippingRateActive(ctx('owner'), { id: rate.data.id, isActive: false });
    expect(await quoteShipping(db, { provinceCode: '01', weightG: 300, locale: 'vi' })).toEqual([]);
    const admin = await listShippingZonesForAdmin(db);
    expect(admin.map((z) => z.name)).toEqual(['Hà Nội', nationwide!.name]);
    expect(admin[0]!.rates[0]).toMatchObject({ isActive: false, names: { en: 'Inner-city 2h' } });

    await deleteShippingZone(ctx('owner'), { id: zone.data.id });
    expect(
      (await quoteShipping(db, { provinceCode: '01', weightG: 300, locale: 'vi' })).length,
    ).toBe(2);
  });

  it('validates weight bands and delivery estimates', () => {
    const result = shippingRateSchema.safeParse({
      zoneId: newId(),
      names: { vi: 'A', en: 'A' },
      minWeightG: 1000,
      maxWeightG: 500,
      fee: 10_000,
      etaMinDays: 3,
      etaMaxDays: 1,
    });
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['maxWeightG', 'maxWeightNotHigher'],
      ['etaMaxDays', 'etaMaxBeforeMin'],
    ]);
  });
});
