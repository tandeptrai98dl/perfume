import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { payments } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { lockOrder } from '@/server/modules/order';

import {
  alertStaff,
  deferredRefundBalance,
  openRefundTotal,
  queueRefund,
  recordDeferredRefund,
  RETURN_PAYOUT_REASON,
} from './ledger';
import { refundableAmount, splitReturnRefund } from './status';

/*
 * Refund of a received customer return (ADR-0017, §3.5): the returns module computes what is
 * owed (returned lines, fees for the shop's fault, return shipping); this pays it, inside the
 * caller's transaction (`splitReturnRefund`):
 * - what the order holds now goes to the refund queue (`refunds.status = requested`; gateway
 *   when one online payment covers it, otherwise bank transfer);
 * - what is still to come — a COD order whose carrier has not remitted yet — is recorded as a
 *   deferred refund (`refund_deferred` event) and queued automatically when the remittance (or
 *   any later payment) is recorded (`settleDeferredRefunds`);
 * - reimbursed return shipping beyond the order's money is queued as a manual payout (bank
 *   transfer, reason `return_shipping_payout`), which never consumes the order's own money;
 * - anything else (e.g. money already refunded by hand) is a shortfall: staff are alerted.
 * The payment status changes later, when staff complete each refund (`completeRefund`).
 */

export type ReturnRefundResult = {
  refundId: string | null;
  queued: number;
  /** Owed once the money arrives (COD remittance): queued automatically then. */
  deferred: number;
  /** Return shipping paid out manually beyond the order's money. */
  payout: number;
  payoutRefundId: string | null;
  /** Owed but neither held, expected nor payable as return shipping: staff decide. */
  shortfall: number;
};

const EMPTY: ReturnRefundResult = {
  refundId: null,
  queued: 0,
  deferred: 0,
  payout: 0,
  payoutRefundId: null,
  shortfall: 0,
};

export async function queueReturnRefund(
  tx: Tx,
  boss: PgBoss,
  input: {
    orderId: string;
    amount: number;
    actorId: string | null;
    reason?: string;
    /** Reimbursed return shipping inside `amount` (the most that may be paid out). */
    returnShipping?: number;
    requestId?: string;
  },
): Promise<ReturnRefundResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
    throw new RangeError('Refund amount must be a non-negative integer (VND)');
  }
  if (input.amount === 0) return EMPTY;
  const reason = input.reason ?? 'return';
  const order = await lockOrder(tx, input.orderId);
  const balance = await deferredRefundBalance(tx, order.id);
  const split = splitReturnRefund({
    amount: input.amount,
    available: refundableAmount(order, await openRefundTotal(tx, order.id)),
    pending: Math.max(0, order.total - order.amountPaid - balance.outstanding),
    payoutCap: Math.min(input.amount, Math.max(0, input.returnShipping ?? 0)),
  });

  let refundId: string | null = null;
  if (split.queued > 0) {
    const [lastPayment] = await tx
      .select({ id: payments.id, provider: payments.provider, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'succeeded')))
      .orderBy(sql`${payments.paidAt} desc nulls last`)
      .limit(1);
    const viaGateway =
      (lastPayment?.provider === 'vnpay' || lastPayment?.provider === 'payos') &&
      lastPayment.amount >= split.queued;
    refundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId: viaGateway ? lastPayment!.id : null,
      amount: split.queued,
      reason,
      method: viaGateway ? 'gateway' : 'bank_transfer',
      actorId: input.actorId,
    });
  }
  if (split.deferred > 0) {
    await recordDeferredRefund(tx, {
      orderId: order.id,
      amount: split.deferred,
      reason,
      actorId: input.actorId,
      requestId: input.requestId,
    });
    await alertStaff(boss, tx, 'late_payment_refund', {
      orderId: order.id,
      message: `Return refund of ${input.amount} VND: ${split.deferred} VND will be queued automatically when the payment (COD remittance) is recorded.`,
    });
  }
  let payoutRefundId: string | null = null;
  if (split.payout > 0) {
    payoutRefundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId: null,
      amount: split.payout,
      reason: RETURN_PAYOUT_REASON,
      method: 'bank_transfer',
      actorId: input.actorId,
    });
  }
  if (split.shortfall > 0) {
    await alertStaff(boss, tx, 'late_payment_refund', {
      orderId: order.id,
      message: `Return refund of ${input.amount} VND: ${split.shortfall} VND exceeds the money the order holds or will receive; check earlier refunds and pay it manually if owed.`,
    });
  }
  return { ...split, refundId, payoutRefundId };
}
