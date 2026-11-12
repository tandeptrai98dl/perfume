import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { orders, payments } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { lockOrder, transitionOrder } from '@/server/modules/order';

import { alertStaff, openRefundTotal, queueRefund, SYSTEM_ACTOR } from './ledger';
import {
  computePaymentStatus,
  isRequirementCovered,
  nextSessionAmount,
  type PaymentStatus,
} from './status';

/*
 * Money consequences of an admin order edit (ARCHITECTURE.md §3.4 step 8, ADR-0005): the order
 * module rewrites the totals, then calls `settleOrderAfterEdit` in the same transaction — the
 * payment module stays the only code that changes `payment_status` and queues refunds.
 * - new total above what was paid (prepaid order) → the difference is due online: the customer
 *   pays it from the order's payment page (a new `adjustment` session, see `sessions.ts`);
 * - new total below the money held → the excess is queued as a `requested` refund;
 * - COD: the deposit was recomputed by the edit; a pending order whose deposit is now covered
 *   is confirmed like after a payment.
 */

export type EditPaymentInput = {
  paymentMethod: string;
  total: number;
  depositRequired: number;
  amountPaid: number;
  amountRefunded: number;
  /** Refunds already queued or in progress. */
  openRefunds: number;
};

export type EditPaymentEffect = {
  paymentStatus: PaymentStatus;
  /** Amount the customer must still pay online (difference / deposit); 0 when none. */
  onlineDue: number;
  /** Money held beyond the new total, to be refunded. */
  refund: number;
};

/** Pure: what an edit to these totals means for the order's money (preview + command). */
export function editPaymentEffect(input: EditPaymentInput): EditPaymentEffect {
  const held = Math.max(0, input.amountPaid - input.amountRefunded - input.openRefunds);
  return {
    paymentStatus: computePaymentStatus(input),
    onlineDue: nextSessionAmount(input),
    refund: Math.max(0, held - input.total),
  };
}

export type SettledEdit = EditPaymentEffect & {
  refundId: string | null;
  /** The pending order was confirmed because its (new) requirement is now covered. */
  confirmed: boolean;
  /** Pending sessions cancelled because their amount no longer matches. */
  cancelledSessions: number;
};

/** Gateway payment that can carry the refund (largest recent one), like cancellations. */
async function refundSource(tx: Tx, orderId: string) {
  const [last] = await tx
    .select({ id: payments.id, provider: payments.provider })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'succeeded')))
    .orderBy(sql`${payments.paidAt} desc nulls last`)
    .limit(1);
  const viaGateway = last?.provider === 'vnpay' || last?.provider === 'payos';
  return {
    paymentId: viaGateway ? last!.id : null,
    method: viaGateway ? 'gateway' : 'bank_transfer',
  } as const;
}

/**
 * Runs after the order module stored the edited totals (order row locked by the caller).
 * Recomputes `payment_status`, cancels pending sessions whose amount is stale, queues the
 * refund of any excess, and confirms a pending order whose requirement became covered.
 */
export async function settleOrderAfterEdit(
  tx: Tx,
  boss: PgBoss,
  input: { orderId: string; actorId: string | null; totalChanged: boolean; reason?: string },
): Promise<SettledEdit> {
  const order = await lockOrder(tx, input.orderId);
  const effect = editPaymentEffect({
    paymentMethod: order.paymentMethod,
    total: order.total,
    depositRequired: order.depositRequired,
    amountPaid: order.amountPaid,
    amountRefunded: order.amountRefunded,
    openRefunds: await openRefundTotal(tx, order.id),
  });

  if (effect.paymentStatus !== order.paymentStatus) {
    await tx
      .update(orders)
      .set({ paymentStatus: effect.paymentStatus })
      .where(eq(orders.id, order.id));
  }

  let cancelledSessions = 0;
  if (input.totalChanged) {
    // A QR/VNPay session for the old amount must not be paid any more (an IPN that still
    // arrives for it is recorded and reconciled like any late payment).
    const cancelled = await tx
      .update(payments)
      .set({ status: 'cancelled' })
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')))
      .returning({ id: payments.id });
    cancelledSessions = cancelled.length;
  }

  let refundId: string | null = null;
  if (effect.refund > 0) {
    const source = await refundSource(tx, order.id);
    refundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId: source.paymentId,
      amount: effect.refund,
      reason: input.reason ?? 'order_edited',
      method: source.method,
      actorId: input.actorId,
    });
    // Someone has to send the money back: tell staff now (ADR-0019; amount only, no PII).
    await alertStaff(boss, tx, 'edit_refund', {
      orderId: order.id,
      message: `Order edit left ${effect.refund} VND above the new total; refund queued.`,
    });
  }

  let confirmed = false;
  if (
    order.status === 'pending' &&
    isRequirementCovered({
      paymentMethod: order.paymentMethod,
      total: order.total,
      depositRequired: order.depositRequired,
      amountPaid: order.amountPaid,
    })
  ) {
    await transitionOrder(tx, boss, {
      orderId: order.id,
      to: 'confirmed',
      actor: SYSTEM_ACTOR,
      reason: 'payment_covered_after_edit',
    });
    confirmed = true;
  }

  return { ...effect, refundId, confirmed, cancelledSessions };
}
