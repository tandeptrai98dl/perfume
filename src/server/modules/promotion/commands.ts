import { and, eq, ne } from 'drizzle-orm';

import { coupons } from '@/server/db/schema';
import { diffRecords, recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  isUniqueViolation,
  type CommandContext,
  type CommandResult,
} from '@/server/lib/command-context';

import type { CouponActiveInput, CouponInput } from './admin-schemas';

/*
 * Coupon management (§11.2 Coupons, RBAC `coupons.manage`: Owner/Manager). Usage counters are
 * written only by `redeemCoupon` at checkout; staff never edit them.
 */

/** Cache tag for cached coupon reads (e.g. a promo banner showing a public code). */
export const promotionTags = { coupons: 'promotion:coupons' } as const;

type CouponRecord = Omit<CouponInput, 'id'>;

function record(row: typeof coupons.$inferSelect): CouponRecord {
  return {
    code: row.code,
    type: row.type,
    value: row.value,
    maxDiscount: row.maxDiscount,
    minSubtotal: row.minSubtotal,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    scope: row.scope as CouponRecord['scope'],
    excludeSaleItems: row.excludeSaleItems,
    isActive: row.isActive,
    note: row.note,
  };
}

const codeTaken = () => new DomainError('invalid', [{ path: 'code', code: 'couponCodeTaken' }]);

export async function saveCoupon(
  ctx: CommandContext,
  input: CouponInput,
): Promise<CommandResult<{ id: string }>> {
  assertCan(ctx.actor, 'coupons.manage');
  const { id: inputId, ...values } = input;
  try {
    return await ctx.db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(and(eq(coupons.code, values.code), inputId ? ne(coupons.id, inputId) : undefined));
      if (clash) throw codeTaken();

      let id: string;
      let before: CouponRecord | null = null;
      if (inputId) {
        const [existing] = await tx
          .select()
          .from(coupons)
          .where(eq(coupons.id, inputId))
          .for('update');
        if (!existing) throw new DomainError('notFound');
        before = record(existing);
        // Orders keep the code they used: a redeemed coupon keeps its code and type.
        if (existing.usedCount > 0 && existing.code.toUpperCase() !== values.code) {
          throw new DomainError('invalid', [{ path: 'code', code: 'couponUsed' }]);
        }
        if (existing.usedCount > 0 && existing.type !== values.type) {
          throw new DomainError('invalid', [{ path: 'type', code: 'couponUsed' }]);
        }
        await tx.update(coupons).set(values).where(eq(coupons.id, inputId));
        id = inputId;
      } else {
        const [row] = await tx.insert(coupons).values(values).returning({ id: coupons.id });
        id = row!.id;
      }
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: inputId ? 'coupon.update' : 'coupon.create',
        entityType: 'coupon',
        entityId: id,
        diff: diffRecords(before, values),
        ip: ctx.ip,
      });
      const tags = await enqueueRevalidation(ctx.boss, tx, [promotionTags.coupons]);
      return { data: { id }, tags };
    });
  } catch (error) {
    // Two staff creating the same code at once: the unique index decides.
    if (isUniqueViolation(error)) throw codeTaken();
    throw error;
  }
}

export async function setCouponActive(
  ctx: CommandContext,
  input: CouponActiveInput,
): Promise<CommandResult<{ id: string; isActive: boolean }>> {
  assertCan(ctx.actor, 'coupons.manage');
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ isActive: coupons.isActive })
      .from(coupons)
      .where(eq(coupons.id, input.id))
      .for('update');
    if (!existing) throw new DomainError('notFound');
    await tx.update(coupons).set({ isActive: input.isActive }).where(eq(coupons.id, input.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: input.isActive ? 'coupon.activate' : 'coupon.deactivate',
      entityType: 'coupon',
      entityId: input.id,
      diff: diffRecords({ isActive: existing.isActive }, { isActive: input.isActive }),
      ip: ctx.ip,
    });
    const tags = await enqueueRevalidation(ctx.boss, tx, [promotionTags.coupons]);
    return { data: { id: input.id, isActive: input.isActive }, tags };
  });
}
