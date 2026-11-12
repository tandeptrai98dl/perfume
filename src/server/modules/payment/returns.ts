import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { payments } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import { lockOrder } from '@/server/modules/order';

import { alertStaff, openRefundTotal, queueRefund } from './ledger';
import { refundableAmount } from './status';

/*
 * Refund of a received customer return (ADR-0017, §3.5): the returns module computes what is
 * owed (returned lines, fees for the shop's fault, return shipping); this queues it in the
 * refund queue (`refunds.status = requested`) inside the caller's transaction. Only money the
 * order still holds can be queued (paid − refunded − already queued). The rest — typically a
 * COD order whose carrier has not remitted yet — is reported as `shortfall` and staff are
 * alerted, so they refund it once the money arrives. The payment status changes later, when
 * staff complete the refund (`completeRefund`), as for every refund.
 */

export type ReturnRefundResult = { refundId: string | null; queued: number; shortfall: number };

export async function queueReturnRefund(
  tx: Tx,
  boss: PgBoss,
  input: { orderId: string; amount: number; actorId: string | null; reason?: string },
): Promise<ReturnRefundResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
    throw new RangeError('Refund amount must be a non-negative integer (VND)');
  }
  if (input.amount === 0) return { refundId: null, queued: 0, shortfall: 0 };
  const order = await lockOrder(tx, input.orderId);
  const available = refundableAmount(order, await openRefundTotal(tx, order.id));
  const queued = Math.min(input.amount, available);
  const shortfall = input.amount - queued;

  let refundId: string | null = null;
  if (queued > 0) {
    const [lastPayment] = await tx
      .select({ id: payments.id, provider: payments.provider, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'succeeded')))
      .orderBy(sql`${payments.paidAt} desc nulls last`)
      .limit(1);
    const viaGateway =
      (lastPayment?.provider === 'vnpay' || lastPayment?.provider === 'payos') &&
      lastPayment.amount >= queued;
    refundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId: viaGateway ? lastPayment!.id : null,
      amount: queued,
      reason: input.reason ?? 'return',
      method: viaGateway ? 'gateway' : 'bank_transfer',
      actorId: input.actorId,
    });
  }
  if (shortfall > 0) {
    await alertStaff(boss, tx, 'late_payment_refund', {
      orderId: order.id,
      message: `Return refund of ${input.amount} VND: ${queued} VND queued, ${shortfall} VND owed once the payment (e.g. COD remittance) is received.`,
    });
  }
  return { refundId, queued, shortfall };
}
