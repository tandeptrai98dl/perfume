import { and, eq, exists, gt, inArray, isNotNull, lt, not, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orders, payments, stockReservations } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { transitionOrder, type OrderStatus } from '@/server/modules/order';
import { getCommerceSettings } from '@/server/modules/settings';

import { queueRefundForCancelledOrder, SYSTEM_ACTOR } from './ledger';
import type { TimeoutRunResult } from './types';

/*
 * Cron jobs that move orders on time limits (ADR-0006, §3.5). Idempotent and safe to run on
 * several workers at once: candidates are re-checked under `FOR UPDATE SKIP LOCKED`, one
 * transaction per order, so a row being paid/edited right now is skipped until the next run.
 */

export type TimeoutDeps = { db: Database; boss: PgBoss; now?: () => Date };

const BATCH_SIZE = 100;
const MAX_BATCHES = 10;

type OrderRow = typeof orders.$inferSelect;

async function lockIfStill(tx: Tx, orderId: string, status: OrderStatus): Promise<OrderRow | null> {
  const [row] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.status, status)))
    .for('update', { skipLocked: true });
  return row ?? null;
}

async function expirePendingSessions(tx: Tx, orderId: string): Promise<void> {
  await tx
    .update(payments)
    .set({ status: 'expired' })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'pending')));
}

/** Runs `handle` for each candidate id, batch after batch, isolating failures per order. */
async function runBatches(
  deps: TimeoutDeps,
  job: string,
  findCandidates: (excluded: string[]) => Promise<string[]>,
  handle: (tx: Tx, orderId: string) => Promise<boolean>,
): Promise<TimeoutRunResult> {
  let processed = 0;
  let skipped = 0;
  const seen: string[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const ids = await findCandidates(seen);
    if (ids.length === 0) break;
    for (const id of ids) {
      seen.push(id);
      try {
        const done = await deps.db.transaction((tx) => handle(tx, id));
        if (done) processed += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        logger.error(`${job}.order_failed`, { orderId: id, ...errorFields(error) });
      }
    }
    if (ids.length < BATCH_SIZE) break;
  }
  if (processed > 0 || skipped > 0) logger.info(`${job}.done`, { processed, skipped });
  return { processed, skipped };
}

const notIn = (excluded: string[]) =>
  excluded.length > 0 ? not(inArray(orders.id, excluded)) : undefined;

function liveReservation(now: Date) {
  return exists(
    sql`(select 1 from ${stockReservations} where ${stockReservations.orderId} = ${orders.id}
      and ${stockReservations.status} = 'active' and ${stockReservations.expiresAt} > ${now})`,
  );
}

/**
 * `orders.expire-unpaid`: pending (online / deposit) orders whose reservations have all
 * expired → cancelled by the system (stock released); stale pending sessions → `expired`.
 */
export async function expireUnpaidOrders(deps: TimeoutDeps): Promise<TimeoutRunResult> {
  const now = deps.now?.() ?? new Date();
  const graceStart = new Date(now.getTime() - 60_000);

  // Sessions past their expiry (any order), in small skip-locked batches.
  await deps.db.execute(sql`
    update ${payments} set status = 'expired', updated_at = now()
    where id in (
      select id from ${payments}
      where status = 'pending' and expires_at < ${now}
      order by expires_at limit 500
      for update skip locked
    )`);

  return runBatches(
    deps,
    'orders.expire-unpaid',
    async (excluded) =>
      (
        await deps.db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.status, 'pending'),
              lt(orders.placedAt, graceStart),
              not(liveReservation(now)),
              notIn(excluded),
            ),
          )
          .orderBy(orders.placedAt)
          .limit(BATCH_SIZE)
      ).map((row) => row.id),
    async (tx, orderId) => {
      const order = await lockIfStill(tx, orderId, 'pending');
      if (!order) return false;
      const [live] = await tx
        .select({ id: stockReservations.id })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.orderId, orderId),
            eq(stockReservations.status, 'active'),
            gt(stockReservations.expiresAt, now),
          ),
        )
        .limit(1);
      if (live) return false;
      await expirePendingSessions(tx, orderId);
      await transitionOrder(tx, deps.boss, {
        orderId,
        to: 'cancelled',
        actor: SYSTEM_ACTOR,
        reason: 'payment_timeout',
      });
      await queueRefundForCancelledOrder(tx, deps.boss, { orderId, actorId: null });
      return true;
    },
  );
}

/** `orders.cancel-unconfirmed-cod`: COD orders not confirmed within the window → cancelled. */
export async function cancelUnconfirmedCodOrders(deps: TimeoutDeps): Promise<TimeoutRunResult> {
  const now = deps.now?.() ?? new Date();
  const settings = await getCommerceSettings(deps.db);
  const cutoff = new Date(now.getTime() - settings.cod.confirmationWindowHours * 3_600_000);
  return runBatches(
    deps,
    'orders.cancel-unconfirmed-cod',
    async (excluded) =>
      (
        await deps.db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.status, 'awaiting_confirmation'),
              lt(orders.placedAt, cutoff),
              notIn(excluded),
            ),
          )
          .orderBy(orders.placedAt)
          .limit(BATCH_SIZE)
      ).map((row) => row.id),
    async (tx, orderId) => {
      const order = await lockIfStill(tx, orderId, 'awaiting_confirmation');
      if (!order || order.placedAt >= cutoff) return false;
      await expirePendingSessions(tx, orderId);
      await transitionOrder(tx, deps.boss, {
        orderId,
        to: 'cancelled',
        actor: SYSTEM_ACTOR,
        reason: 'cod_not_confirmed',
      });
      await queueRefundForCancelledOrder(tx, deps.boss, { orderId, actorId: null });
      return true;
    },
  );
}

/** `orders.complete-delivered`: delivered longer than the return window → completed. */
export async function completeDeliveredOrders(deps: TimeoutDeps): Promise<TimeoutRunResult> {
  const now = deps.now?.() ?? new Date();
  const settings = await getCommerceSettings(deps.db);
  const cutoff = new Date(now.getTime() - settings.returnsWindowDays * 86_400_000);
  return runBatches(
    deps,
    'orders.complete-delivered',
    async (excluded) =>
      (
        await deps.db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.status, 'delivered'),
              isNotNull(orders.deliveredAt),
              lt(orders.deliveredAt, cutoff),
              notIn(excluded),
            ),
          )
          .orderBy(orders.deliveredAt)
          .limit(BATCH_SIZE)
      ).map((row) => row.id),
    async (tx, orderId) => {
      const order = await lockIfStill(tx, orderId, 'delivered');
      if (!order?.deliveredAt || order.deliveredAt >= cutoff) return false;
      await transitionOrder(tx, deps.boss, {
        orderId,
        to: 'completed',
        actor: SYSTEM_ACTOR,
        reason: 'return_window_passed',
      });
      return true;
    },
  );
}
