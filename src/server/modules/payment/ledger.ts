import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { orders, payments, refunds } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import type { Tx } from '@/server/lib/command-context';
import { recordOrderEvent, transitionOrder, type OrderActor } from '@/server/modules/order';

import {
  computePaymentStatus,
  isRequirementCovered,
  overpayment,
  refundableAmount,
  type PaymentStatus,
} from './status';

/*
 * The money ledger of an order: the ONLY code that changes `orders.payment_status`,
 * `amount_paid` and `amount_refunded` (ADR-0005). Every function runs inside the caller's
 * transaction with the order row already locked (`lockOrder`) — lock order: order → payment.
 */

type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

export const SYSTEM_ACTOR: OrderActor = { type: 'system', id: null };

/** Statuses in which incoming money is unexpected and goes back to the customer. */
const REFUND_ON_PAYMENT: readonly string[] = ['cancelled', 'returned'];

export type StaffAlertKind = 'suspicious_ipn' | 'late_payment_refund' | 'edit_refund';

/** Internal alert (ADR-0019). `message` must never contain PII. */
export async function alertStaff(
  boss: PgBoss,
  tx: Tx,
  kind: StaffAlertKind,
  input: { orderId?: string | null; message: string },
): Promise<void> {
  await enqueue(boss, tx, 'staff.alert', {
    kind,
    ...(input.orderId ? { orderId: input.orderId } : {}),
    message: input.message.slice(0, 500),
  });
}

/** Sum of refunds that are queued or in progress (they reserve refundable money). */
export async function openRefundTotal(tx: Pick<Tx, 'select'>, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), inArray(refunds.status, ['requested', 'processing'])));
  return Number(row?.total ?? 0);
}

/** Adds a refund to the queue (status `requested`); the caller has locked the order. */
export async function queueRefund(
  tx: Tx,
  input: {
    orderId: string;
    paymentId: string | null;
    amount: number;
    reason: string;
    method: 'gateway' | 'bank_transfer' | 'cash';
    actorId: string | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(refunds)
    .values({
      orderId: input.orderId,
      paymentId: input.paymentId,
      amount: input.amount,
      reason: input.reason,
      method: input.method,
      actorId: input.actorId,
    })
    .returning({ id: refunds.id });
  await recordOrderEvent(tx, {
    orderId: input.orderId,
    type: 'refund_requested',
    message: input.reason,
    actor: input.actorId ? { type: 'staff', id: input.actorId } : SYSTEM_ACTOR,
    metadata: { refundId: row!.id, amount: input.amount, method: input.method },
  });
  return row!.id;
}

async function writeOrderMoney(
  tx: Tx,
  order: OrderRow,
  next: { amountPaid: number; amountRefunded: number },
): Promise<{ from: PaymentStatus; to: PaymentStatus }> {
  const from = order.paymentStatus as PaymentStatus;
  const to = computePaymentStatus({ total: order.total, ...next });
  await tx
    .update(orders)
    .set({
      amountPaid: next.amountPaid,
      amountRefunded: next.amountRefunded,
      paymentStatus: to,
      version: sql`${orders.version} + 1`,
    })
    .where(eq(orders.id, order.id));
  return { from, to };
}

export type AppliedPayment = {
  paymentStatus: PaymentStatus;
  confirmed: boolean;
  refundId: string | null;
};

/**
 * A verified payment arrived (IPN/webhook, manual bank transfer, COD remittance): mark the
 * attempt succeeded, add it to `amount_paid`, recompute `payment_status`, then
 * - order `pending` and the requirement covered (total, or deposit for COD) → `confirmed`
 *   through `transitionOrder` (commits the reservations);
 * - order cancelled/returned → the money is recorded and queued for refund + staff alert;
 * - more than the total received → the excess is queued for refund + staff alert.
 */
export async function applySucceededPayment(
  tx: Tx,
  boss: PgBoss,
  input: {
    order: OrderRow;
    payment: PaymentRow;
    providerTxnId?: string | null;
    bankCode?: string | null;
    paidAt?: Date | null;
    confirmedBy?: string | null;
    actor: OrderActor;
  },
): Promise<AppliedPayment> {
  const { order, payment } = input;
  await tx
    .update(payments)
    .set({
      status: 'succeeded',
      paidAt: input.paidAt ?? new Date(),
      providerTxnId: input.providerTxnId ?? payment.providerTxnId,
      bankCode: input.bankCode ?? payment.bankCode,
      confirmedBy: input.confirmedBy ?? payment.confirmedBy,
    })
    .where(eq(payments.id, payment.id));

  const amountPaid = order.amountPaid + payment.amount;
  const change = await writeOrderMoney(tx, order, {
    amountPaid,
    amountRefunded: order.amountRefunded,
  });
  await recordOrderEvent(tx, {
    orderId: order.id,
    type: 'payment_received',
    actor: input.actor,
    diff: {
      paymentStatus: change,
      amountPaid: { from: order.amountPaid, to: amountPaid },
    },
    metadata: {
      paymentId: payment.id,
      provider: payment.provider,
      kind: payment.kind,
      amount: payment.amount,
    },
  });
  await enqueue(boss, tx, 'payment.received', { orderId: order.id, paymentId: payment.id });

  let confirmed = false;
  let refundId: string | null = null;
  if (REFUND_ON_PAYMENT.includes(order.status)) {
    refundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId: payment.id,
      amount: payment.amount,
      reason: 'late_payment_after_cancellation',
      method: 'gateway',
      actorId: null,
    });
    await alertStaff(boss, tx, 'late_payment_refund', {
      orderId: order.id,
      message: `Payment ${payment.txnRef} (${payment.amount} VND) arrived after the order was ${order.status}; refund queued.`,
    });
  } else {
    if (
      order.status === 'pending' &&
      isRequirementCovered({
        paymentMethod: order.paymentMethod,
        total: order.total,
        depositRequired: order.depositRequired,
        amountPaid,
      })
    ) {
      await transitionOrder(tx, boss, {
        orderId: order.id,
        to: 'confirmed',
        actor: SYSTEM_ACTOR,
        reason: 'payment_received',
        metadata: { paymentId: payment.id },
      });
      confirmed = true;
    }
    const excess = Math.min(
      overpayment({ total: order.total, amountPaid }),
      refundableAmount(
        { amountPaid, amountRefunded: order.amountRefunded },
        await openRefundTotal(tx, order.id),
      ),
    );
    if (excess > 0) {
      refundId = await queueRefund(tx, {
        orderId: order.id,
        paymentId: payment.id,
        amount: excess,
        reason: 'overpayment',
        method: 'gateway',
        actorId: null,
      });
      await alertStaff(boss, tx, 'late_payment_refund', {
        orderId: order.id,
        message: `Order received ${excess} VND more than its total; refund queued.`,
      });
    }
  }
  return { paymentStatus: change.to, confirmed, refundId };
}

/**
 * Records a completed refund: `amount_refunded` grows, `payment_status` becomes
 * `partially_refunded` / `refunded`; the attempt is marked `refunded` once fully returned.
 */
export async function applyCompletedRefund(
  tx: Tx,
  input: { order: OrderRow; refund: typeof refunds.$inferSelect; actor: OrderActor },
): Promise<PaymentStatus> {
  const { order, refund } = input;
  const amountRefunded = order.amountRefunded + refund.amount;
  const change = await writeOrderMoney(tx, order, {
    amountPaid: order.amountPaid,
    amountRefunded,
  });
  if (refund.paymentId) {
    const [payment] = await tx
      .select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.id, refund.paymentId))
      .for('update');
    const [done] = await tx
      .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, refund.paymentId), eq(refunds.status, 'completed')));
    if (payment && Number(done?.total ?? 0) >= payment.amount) {
      await tx
        .update(payments)
        .set({ status: 'refunded' })
        .where(eq(payments.id, refund.paymentId));
    }
  }
  if (change.to === 'refunded') {
    // Everything went back: no attempt of this order still holds money.
    await tx
      .update(payments)
      .set({ status: 'refunded' })
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'succeeded')));
  }
  await recordOrderEvent(tx, {
    orderId: order.id,
    type: 'refund_completed',
    message: refund.reason,
    actor: input.actor,
    diff: {
      paymentStatus: change,
      amountRefunded: { from: order.amountRefunded, to: amountRefunded },
    },
    metadata: { refundId: refund.id, amount: refund.amount, method: refund.method },
  });
  return change.to;
}

/**
 * After a cancellation: whatever is still held (paid − refunded − queued) goes to the refund
 * queue with a staff alert. Used by the timeout jobs; admin cancellations should call it too.
 */
export async function queueRefundForCancelledOrder(
  tx: Tx,
  boss: PgBoss,
  input: { orderId: string; actorId: string | null; reason?: string },
): Promise<string | null> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for('update');
  if (!order) return null;
  const amount = refundableAmount(order, await openRefundTotal(tx, order.id));
  if (amount <= 0) return null;
  const [lastPayment] = await tx
    .select({ id: payments.id, provider: payments.provider })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, 'succeeded')))
    .orderBy(sql`${payments.paidAt} desc nulls last`)
    .limit(1);
  const viaGateway = lastPayment?.provider === 'vnpay' || lastPayment?.provider === 'payos';
  const refundId = await queueRefund(tx, {
    orderId: order.id,
    paymentId: viaGateway ? lastPayment!.id : null,
    amount,
    reason: input.reason ?? 'order_cancelled',
    method: viaGateway ? 'gateway' : 'bank_transfer',
    actorId: input.actorId,
  });
  await alertStaff(boss, tx, 'late_payment_refund', {
    orderId: order.id,
    message: `Cancelled order still holds ${amount} VND; refund queued.`,
  });
  return refundId;
}
