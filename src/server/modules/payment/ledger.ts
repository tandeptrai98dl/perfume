import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { orderEvents, orders, payments, refunds } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import type { Tx } from '@/server/lib/command-context';
import {
  RETURN_EVENTS,
  recordOrderEvent,
  transitionOrder,
  type OrderActor,
} from '@/server/modules/order';

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

/**
 * Reimbursed return shipping paid out beyond the money the order holds (ADR-0017, M3 wave 3):
 * a manual bank-transfer/cash refund with this reason and no payment attempt. It never reserves
 * or consumes the order's own money (`openRefundTotal`, `amount_refunded`): it is a cost of the
 * shop, not a refund of the sale. Staff cannot create one by hand (`requestRefund`).
 */
export const RETURN_PAYOUT_REASON = 'return_shipping_payout';

export function isPayoutRefund(refund: { reason: string; paymentId: string | null }): boolean {
  return refund.reason === RETURN_PAYOUT_REASON && refund.paymentId === null;
}

/** Refunds taken from the order's money (everything except return-shipping payouts). */
const notPayout = or(ne(refunds.reason, RETURN_PAYOUT_REASON), isNotNull(refunds.paymentId));

/** Sum of refunds that are queued or in progress (they reserve refundable money). */
export async function openRefundTotal(tx: Pick<Tx, 'select'>, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
    .from(refunds)
    .where(
      and(
        eq(refunds.orderId, orderId),
        inArray(refunds.status, ['requested', 'processing']),
        notPayout,
      ),
    );
  return Number(row?.total ?? 0);
}

// ---------- Deferred refunds (customer returns before the money arrived) ----------

/**
 * `refund_deferred` order event: a customer return is owed money the order does not hold yet
 * (COD the carrier has not remitted). Metadata `{ amount, reason, requestId? }`. Every
 * `refund_requested` event that settles part of it carries `metadata.deferred` (the amount
 * settled), so the outstanding balance is Σ deferred − Σ settled.
 */
export const DEFERRED_REFUND_EVENT = 'refund_deferred';

export async function deferredRefundBalance(
  tx: Pick<Tx, 'select'>,
  orderId: string,
): Promise<{ deferred: number; settled: number; outstanding: number; reason: string | null }> {
  const [row] = await tx
    .select({
      deferred: sql<string>`coalesce(sum(case when ${orderEvents.type} = ${DEFERRED_REFUND_EVENT}
        then (${orderEvents.metadata}->>'amount')::bigint end), 0)`,
      settled: sql<string>`coalesce(sum(case when ${orderEvents.type} = 'refund_requested'
        then (${orderEvents.metadata}->>'deferred')::bigint end), 0)`,
      reason: sql<string | null>`(array_agg(${orderEvents.metadata}->>'reason' order by
        ${orderEvents.createdAt} desc) filter (where ${orderEvents.type} = ${DEFERRED_REFUND_EVENT}))[1]`,
    })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        inArray(orderEvents.type, [DEFERRED_REFUND_EVENT, 'refund_requested']),
      ),
    );
  const deferred = Number(row?.deferred ?? 0);
  const settled = Number(row?.settled ?? 0);
  return {
    deferred,
    settled,
    outstanding: Math.max(0, deferred - settled),
    reason: row?.reason ?? null,
  };
}

/** Records a deferred refund (caller holds the order lock). */
export async function recordDeferredRefund(
  tx: Tx,
  input: {
    orderId: string;
    amount: number;
    reason: string;
    actorId: string | null;
    requestId?: string;
  },
): Promise<void> {
  await recordOrderEvent(tx, {
    orderId: input.orderId,
    type: DEFERRED_REFUND_EVENT,
    message: input.reason,
    actor: input.actorId ? { type: 'staff', id: input.actorId } : SYSTEM_ACTOR,
    metadata: {
      amount: input.amount,
      reason: input.reason,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    },
  });
}

/**
 * Money arrived (COD remittance, bank transfer): queue what is owed from deferred return
 * refunds, as far as the order now holds it (manual bank transfer to the customer). Returns
 * the refund id, or null when nothing was owed or held. Caller holds the order lock.
 */
export async function settleDeferredRefunds(
  tx: Tx,
  boss: PgBoss,
  input: { orderId: string },
): Promise<string | null> {
  const balance = await deferredRefundBalance(tx, input.orderId);
  if (balance.outstanding <= 0) return null;
  const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
  if (!order) return null;
  const amount = Math.min(
    balance.outstanding,
    refundableAmount(order, await openRefundTotal(tx, order.id)),
  );
  if (amount <= 0) return null;
  const refundId = await queueRefund(tx, {
    orderId: order.id,
    paymentId: null,
    amount,
    reason: balance.reason ?? 'return',
    method: 'bank_transfer',
    actorId: null,
    deferred: amount,
  });
  await alertStaff(boss, tx, 'late_payment_refund', {
    orderId: order.id,
    message: `Payment received for a returned order: ${amount} VND owed to the customer queued for refund (bank transfer)${
      balance.outstanding > amount ? `, ${balance.outstanding - amount} VND still owed` : ''
    }.`,
  });
  return refundId;
}

/** The order went through a received customer return (not a failed delivery sent back). */
async function hasReceivedReturn(tx: Pick<Tx, 'select'>, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: orderEvents.id })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, RETURN_EVENTS.received)))
    .limit(1);
  return !!row;
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
    /** Part of a deferred return refund this refund settles (`deferredRefundBalance`). */
    deferred?: number;
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
    metadata: {
      refundId: row!.id,
      amount: input.amount,
      method: input.method,
      ...(input.deferred ? { deferred: input.deferred } : {}),
    },
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
  // A customer return received before the money arrived (COD not remitted yet, ADR-0017):
  // the money is the shop's except what the return owes, which the deferred refund queues
  // below — not the whole payment as for a cancelled order or a failed delivery.
  const customerReturn = order.status === 'returned' && (await hasReceivedReturn(tx, order.id));
  if (REFUND_ON_PAYMENT.includes(order.status) && !customerReturn) {
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
  refundId = (await settleDeferredRefunds(tx, boss, { orderId: order.id })) ?? refundId;
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
