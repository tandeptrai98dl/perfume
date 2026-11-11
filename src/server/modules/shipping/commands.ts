import { desc, eq, inArray } from 'drizzle-orm';

import {
  provinces,
  shipments,
  shippingRates,
  shippingRateTranslations,
  shippingZones,
} from '@/server/db/schema';
import { diffRecords, prefixDiff, recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';

import type {
  ShippingEntityIdInput,
  ShippingRateActiveInput,
  ShippingRateInput,
  ShippingZoneInput,
} from './admin-schemas';

/*
 * Shipping write side (§11.2 Shipping, ADR-0018): shipments entered by staff (carrier portal +
 * tracking code in MVP) and zone/weight-band rates. Rates change checkout prices, so editing
 * them needs `settings.manage` (Owner) like the other commerce settings.
 */

/** Cache tag for every cached read of zones/rates (cart free-shipping bar, checkout quotes). */
export const shippingTags = { rates: 'shipping:rates' } as const;

export const SHIPPING_PERMISSION = 'settings.manage' as const;

export type ShipmentStatus = 'pending' | 'in_transit' | 'delivered' | 'failed' | 'returned';

/** Records the parcel handed to the carrier; runs inside the order transition's transaction. */
export async function createShipment(
  tx: Pick<Tx, 'insert'>,
  input: {
    orderId: string;
    carrier: 'self' | 'ghn' | 'ghtk' | 'viettel_post' | 'other';
    trackingCode: string;
    codAmount: number;
    feeActual?: number | null;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(shipments)
    .values({
      orderId: input.orderId,
      carrier: input.carrier,
      trackingCode: input.trackingCode,
      codAmount: input.codAmount,
      feeActual: input.feeActual ?? null,
      status: 'in_transit',
      shippedAt: new Date(),
    })
    .returning({ id: shipments.id });
  return row!;
}

/** Mirrors an order's delivery outcome on its latest shipment (no-op without a shipment). */
export async function updateLatestShipmentStatus(
  tx: Pick<Tx, 'select' | 'update'>,
  orderId: string,
  status: ShipmentStatus,
): Promise<void> {
  const [latest] = await tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  if (!latest) return;
  await tx
    .update(shipments)
    .set({ status, ...(status === 'delivered' ? { deliveredAt: new Date() } : {}) })
    .where(eq(shipments.id, latest.id));
}

async function assertProvinces(tx: Pick<Tx, 'select'>, codes: readonly string[]) {
  const found = await tx
    .select({ code: provinces.code })
    .from(provinces)
    .where(inArray(provinces.code, [...codes]));
  if (found.length !== codes.length) {
    throw new DomainError('invalid', [{ path: 'provinceCodes', code: 'invalid' }]);
  }
}

async function revalidate(ctx: CommandContext, tx: Tx) {
  return enqueueRevalidation(ctx.boss, tx, [shippingTags.rates]);
}

export async function saveShippingZone(
  ctx: CommandContext,
  input: ShippingZoneInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, SHIPPING_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    await assertProvinces(tx, input.provinceCodes);
    const values = {
      name: input.name,
      provinceCodes: input.provinceCodes,
      position: input.position,
    };
    let id: string;
    let before: Record<string, unknown> | null = null;
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(shippingZones)
        .where(eq(shippingZones.id, input.id))
        .for('update');
      if (!existing) throw new DomainError('notFound');
      before = {
        name: existing.name,
        provinceCodes: existing.provinceCodes,
        position: existing.position,
      };
      await tx.update(shippingZones).set(values).where(eq(shippingZones.id, input.id));
      id = input.id;
    } else {
      const [row] = await tx
        .insert(shippingZones)
        .values(values)
        .returning({ id: shippingZones.id });
      id = row!.id;
    }
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: input.id ? 'shipping.zone.update' : 'shipping.zone.create',
      entityType: 'shipping_zone',
      entityId: id,
      diff: diffRecords(before, values),
      ip: ctx.ip,
    });
    return { data: { id }, tags: await revalidate(ctx, tx) };
  });
}

/** Deletes a zone and its rates (orders keep their own fee snapshot). */
export async function deleteShippingZone(
  ctx: CommandContext,
  input: ShippingEntityIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, SHIPPING_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(shippingZones)
      .where(eq(shippingZones.id, input.id))
      .returning({ id: shippingZones.id, name: shippingZones.name });
    if (!deleted) throw new DomainError('notFound');
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'shipping.zone.delete',
      entityType: 'shipping_zone',
      entityId: deleted.id,
      diff: diffRecords({ name: deleted.name }, null),
      ip: ctx.ip,
    });
    return { data: { id: deleted.id }, tags: await revalidate(ctx, tx) };
  });
}

type RateRecord = Omit<ShippingRateInput, 'id' | 'names'>;

function rateRecord(input: ShippingRateInput): RateRecord {
  return {
    zoneId: input.zoneId,
    minWeightG: input.minWeightG,
    maxWeightG: input.maxWeightG,
    fee: input.fee,
    freeOverSubtotal: input.freeOverSubtotal,
    etaMinDays: input.etaMinDays,
    etaMaxDays: input.etaMaxDays,
    isActive: input.isActive,
    position: input.position,
  };
}

export async function saveShippingRate(
  ctx: CommandContext,
  input: ShippingRateInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, SHIPPING_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const [zone] = await tx
      .select({ id: shippingZones.id })
      .from(shippingZones)
      .where(eq(shippingZones.id, input.zoneId));
    if (!zone) throw new DomainError('invalid', [{ path: 'zoneId', code: 'invalid' }]);

    const values = rateRecord(input);
    let id: string;
    let before: Record<string, unknown> | null = null;
    let beforeNames: Record<string, unknown> | null = null;
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(shippingRates)
        .where(eq(shippingRates.id, input.id))
        .for('update');
      if (!existing) throw new DomainError('notFound');
      before = {
        zoneId: existing.zoneId,
        minWeightG: existing.minWeightG,
        maxWeightG: existing.maxWeightG,
        fee: existing.fee,
        freeOverSubtotal: existing.freeOverSubtotal,
        etaMinDays: existing.etaMinDays,
        etaMaxDays: existing.etaMaxDays,
        isActive: existing.isActive,
        position: existing.position,
      };
      const names = await tx
        .select({ locale: shippingRateTranslations.locale, name: shippingRateTranslations.name })
        .from(shippingRateTranslations)
        .where(eq(shippingRateTranslations.rateId, input.id));
      beforeNames = Object.fromEntries(names.map((row) => [row.locale, row.name]));
      await tx.update(shippingRates).set(values).where(eq(shippingRates.id, input.id));
      id = input.id;
    } else {
      const [row] = await tx
        .insert(shippingRates)
        .values(values)
        .returning({ id: shippingRates.id });
      id = row!.id;
    }
    for (const locale of ['vi', 'en'] as const) {
      await tx
        .insert(shippingRateTranslations)
        .values({ rateId: id, locale, name: input.names[locale] })
        .onConflictDoUpdate({
          target: [shippingRateTranslations.rateId, shippingRateTranslations.locale],
          set: { name: input.names[locale] },
        });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: input.id ? 'shipping.rate.update' : 'shipping.rate.create',
      entityType: 'shipping_rate',
      entityId: id,
      diff: {
        ...diffRecords(before, values),
        ...prefixDiff('names.', diffRecords(beforeNames, input.names)),
      },
      ip: ctx.ip,
    });
    return { data: { id }, tags: await revalidate(ctx, tx) };
  });
}

export async function setShippingRateActive(
  ctx: CommandContext,
  input: ShippingRateActiveInput,
): Promise<CommandResult<{ id: string; isActive: boolean }>> {
  assertCan(ctx.actor, SHIPPING_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ isActive: shippingRates.isActive })
      .from(shippingRates)
      .where(eq(shippingRates.id, input.id))
      .for('update');
    if (!existing) throw new DomainError('notFound');
    await tx
      .update(shippingRates)
      .set({ isActive: input.isActive })
      .where(eq(shippingRates.id, input.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: input.isActive ? 'shipping.rate.activate' : 'shipping.rate.deactivate',
      entityType: 'shipping_rate',
      entityId: input.id,
      diff: diffRecords({ isActive: existing.isActive }, { isActive: input.isActive }),
      ip: ctx.ip,
    });
    return { data: { id: input.id, isActive: input.isActive }, tags: await revalidate(ctx, tx) };
  });
}

export async function deleteShippingRate(
  ctx: CommandContext,
  input: ShippingEntityIdInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, SHIPPING_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(shippingRates)
      .where(eq(shippingRates.id, input.id))
      .returning({ id: shippingRates.id, fee: shippingRates.fee });
    if (!deleted) throw new DomainError('notFound');
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'shipping.rate.delete',
      entityType: 'shipping_rate',
      entityId: deleted.id,
      diff: diffRecords({ fee: deleted.fee }, null),
      ip: ctx.ip,
    });
    return { data: { id: deleted.id }, tags: await revalidate(ctx, tx) };
  });
}
