import { eq } from 'drizzle-orm';

import { paymentEvents, payments } from '@/server/db/schema';
import type { GatewayNotification } from '@/server/integrations/payments';
import type { Tx } from '@/server/lib/command-context';
import { lockOrder } from '@/server/modules/order';

import { alertStaff, applySucceededPayment, SYSTEM_ACTOR } from './ledger';
import type { PaymentDeps, NotificationResult } from './types';

/*
 * IPN/webhook processing (ARCHITECTURE.md §3.4 step 4, §12 Payments, CLAUDE.md "Webhooks"):
 * 1. every notification is stored in `payment_events`, valid or not;
 * 2. the unique `idempotency_key` turns a replay into an acknowledged no-op;
 * 3. invalid signature, unknown `txn_ref` or a different amount → staff alert, no state change;
 * 4. otherwise, in the same transaction: attempt succeeded, `amount_paid`, `payment_status`,
 *    order confirmation or refund queue (see `applySucceededPayment`).
 * Return URLs never come here: they only display status.
 */

const empty = (outcome: NotificationResult['outcome'], orderId: string | null = null) => ({
  outcome,
  orderId,
  paymentStatus: null,
  confirmed: false,
  refundId: null,
});

async function recordEvent(tx: Tx, n: GatewayNotification): Promise<string | null> {
  const [row] = await tx
    .insert(paymentEvents)
    .values({
      provider: n.provider,
      eventType: n.eventType,
      idempotencyKey: n.idempotencyKey,
      payload: n.payload,
      signatureValid: n.signatureValid,
    })
    .onConflictDoNothing({ target: paymentEvents.idempotencyKey })
    .returning({ id: paymentEvents.id });
  return row?.id ?? null;
}

async function closeEvent(
  tx: Tx,
  eventId: string,
  values: { paymentId?: string | null; error?: string | null },
) {
  await tx
    .update(paymentEvents)
    .set({
      processedAt: new Date(),
      paymentId: values.paymentId ?? null,
      error: values.error ?? null,
    })
    .where(eq(paymentEvents.id, eventId));
}

export async function processGatewayNotification(
  deps: Pick<PaymentDeps, 'db' | 'boss'>,
  n: GatewayNotification,
): Promise<NotificationResult> {
  const { db, boss } = deps;

  if (!n.signatureValid) {
    return db.transaction(async (tx) => {
      const eventId = await recordEvent(tx, n);
      if (eventId) {
        await closeEvent(tx, eventId, { error: 'invalid_signature' });
        await alertStaff(boss, tx, 'suspicious_ipn', {
          message: `${n.provider} notification with an invalid signature (event ${eventId}).`,
        });
      }
      return empty('invalid_signature');
    });
  }

  return db.transaction(async (tx) => {
    const eventId = await recordEvent(tx, n);
    if (!eventId) return empty('duplicate');

    const [found] = n.txnRef
      ? await tx.select().from(payments).where(eq(payments.txnRef, n.txnRef)).limit(1)
      : [];
    if (!found || found.provider !== n.provider) {
      await closeEvent(tx, eventId, { error: 'unknown_txn_ref' });
      await alertStaff(boss, tx, 'suspicious_ipn', {
        message: `${n.provider} notification for an unknown transaction reference (event ${eventId}).`,
      });
      return empty('unknown_txn');
    }

    // Lock order → payment (same order as the timeout jobs: no deadlocks).
    const order = await lockOrder(tx, found.orderId);
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, found.id))
      .for('update');

    if (!n.success) {
      if (payment!.status === 'pending') {
        await tx
          .update(payments)
          .set({ status: 'failed', raw: { ...(payment!.raw as object), lastEvent: n.eventType } })
          .where(eq(payments.id, payment!.id));
      }
      await closeEvent(tx, eventId, { paymentId: payment!.id });
      return empty('failed_payment', order.id);
    }

    if (n.amount !== payment!.amount) {
      await closeEvent(tx, eventId, { paymentId: payment!.id, error: 'amount_mismatch' });
      await alertStaff(boss, tx, 'suspicious_ipn', {
        orderId: order.id,
        message: `${n.provider} reported ${n.amount ?? 'no'} VND for ${payment!.txnRef}, expected ${payment!.amount} VND. Nothing changed.`,
      });
      return empty('amount_mismatch', order.id);
    }

    if (payment!.status === 'succeeded' || payment!.status === 'refunded') {
      await closeEvent(tx, eventId, { paymentId: payment!.id, error: 'already_succeeded' });
      await alertStaff(boss, tx, 'suspicious_ipn', {
        orderId: order.id,
        message: `Second successful ${n.provider} notification for settled payment ${payment!.txnRef}; check for a double payment.`,
      });
      return empty('already_paid', order.id);
    }

    const applied = await applySucceededPayment(tx, boss, {
      order,
      payment: payment!,
      providerTxnId: n.providerTxnId,
      bankCode: n.bankCode,
      paidAt: n.paidAt,
      actor: SYSTEM_ACTOR,
    });
    await closeEvent(tx, eventId, { paymentId: payment!.id });
    return {
      outcome: 'processed',
      orderId: order.id,
      paymentStatus: applied.paymentStatus,
      confirmed: applied.confirmed,
      refundId: applied.refundId,
    };
  });
}
