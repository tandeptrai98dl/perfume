import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { codRemittanceOrders, codRemittances, payments, refunds } from '@/server/db/schema';
import type { PaymentGateways } from '@/server/integrations/payments';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  isUniqueViolation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { lockOrder, type OrderActor } from '@/server/modules/order';

import {
  applyCompletedRefund,
  applySucceededPayment,
  openRefundTotal,
  queueRefund,
} from './ledger';
import type {
  CodRemittanceInput,
  CompleteRefundInput,
  ConfirmBankTransferInput,
  RequestRefundInput,
} from './schemas';
import { refundableAmount, remittanceDifference } from './status';
import { generateTxnRef } from './txn-ref';

/*
 * Staff payment commands (ARCHITECTURE.md §11.1–11.2): manual bank transfer confirmation and
 * COD remittance (`payments.confirmBankTransfer` / `payments.reconcileCod`, Owner/Manager),
 * refunds (`payments.refund`). Each runs in one transaction with an audit row.
 */

/** Payment money is not cached by the storefront: no cache tags to revalidate. */
const NO_TAGS: string[] = [];

const field = (path: string, code: string) => new DomainError('invalid', [{ path, code }]);

const staffActor = (ctx: CommandContext): OrderActor => ({ type: 'staff', id: ctx.actor.id });

async function insertSucceededAttempt(
  tx: Tx,
  values: Omit<typeof payments.$inferInsert, 'txnRef' | 'status'>,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(payments)
          .values({ ...values, txnRef: generateTxnRef(), status: 'pending' })
          .returning();
        return row!;
      });
    } catch (error) {
      if (attempt < 4 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

const UNPAYABLE = ['cancelled', 'returned'];

// ---------- Manual bank transfer (§3.4 step 7) ----------

export type ManualTransferResult = { paymentId: string; paymentStatus: string; confirmed: boolean };

/**
 * Records money a Manager saw on the bank statement, inside the caller's transaction: a
 * succeeded `bank_manual` attempt, the ledger update (order `pending` → `confirmed` once
 * covered), an audit row. Used by the bank-transfer queue and by manual orders whose transfer
 * was received before the order was entered (§3.4 step 7).
 */
export async function recordManualBankTransfer(
  ctx: CommandContext,
  tx: Tx,
  input: ConfirmBankTransferInput,
): Promise<ManualTransferResult> {
  assertCan(ctx.actor, 'payments.confirmBankTransfer');
  const order = await lockOrder(tx, input.orderId);
  if (UNPAYABLE.includes(order.status)) throw field('orderId', 'notPayable');
  const due = order.total - order.amountPaid;
  if (input.amount > due) throw field('amount', 'exceedsDue');

  const kind =
    order.amountPaid === 0 && input.amount >= order.total
      ? 'full'
      : order.paymentMethod === 'cod' && order.amountPaid === 0
        ? 'deposit'
        : 'balance';
  const payment = await insertSucceededAttempt(tx, {
    orderId: order.id,
    provider: 'bank_manual',
    kind,
    amount: input.amount,
    providerTxnId: input.bankReference,
    confirmedBy: ctx.actor.id,
    raw: input.note ? { note: input.note } : null,
  });
  const applied = await applySucceededPayment(tx, ctx.boss, {
    order,
    payment,
    providerTxnId: input.bankReference,
    confirmedBy: ctx.actor.id,
    actor: staffActor(ctx),
  });
  await recordAudit(tx, {
    actorId: ctx.actor.id,
    action: 'payment.confirm_bank_transfer',
    entityType: 'order',
    entityId: order.id,
    diff: {
      amount: input.amount,
      bankReference: input.bankReference,
      paymentStatus: { from: order.paymentStatus, to: applied.paymentStatus },
    },
    ip: ctx.ip,
  });
  return {
    paymentId: payment.id,
    paymentStatus: applied.paymentStatus,
    confirmed: applied.confirmed,
  };
}

export async function confirmBankTransfer(
  ctx: CommandContext,
  input: ConfirmBankTransferInput,
): Promise<CommandResult<ManualTransferResult>> {
  assertCan(ctx.actor, 'payments.confirmBankTransfer');
  return ctx.db.transaction(async (tx) => ({
    data: await recordManualBankTransfer(ctx, tx, input),
    tags: NO_TAGS,
  }));
}

// ---------- COD remittance (§3.4 step 6) ----------

/** Carriers remit after delivery; delivery-failed/returned parcels collected nothing. */
const REMITTABLE = ['delivered', 'completed', 'return_requested'];

export async function createCodRemittance(
  ctx: CommandContext,
  input: CodRemittanceInput,
): Promise<CommandResult<{ remittanceId: string; expected: number; difference: number }>> {
  assertCan(ctx.actor, 'payments.reconcileCod');
  return ctx.db.transaction(async (tx) => {
    const [remittance] = await tx
      .insert(codRemittances)
      .values({
        carrier: input.carrier,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalAmount: input.totalAmount,
        carrierFee: input.carrierFee,
        receivedAt: new Date(`${input.receivedAt}T12:00:00+07:00`),
        bankReference: input.bankReference,
        createdBy: ctx.actor.id,
      })
      .returning({ id: codRemittances.id });

    const sorted = [...input.orders].sort((a, b) => a.orderId.localeCompare(b.orderId));
    const issues: { path: string; code: string }[] = [];
    for (const [index, line] of sorted.entries()) {
      const order = await lockOrder(tx, line.orderId).catch(() => null);
      const path = `orders.${input.orders.findIndex((o) => o.orderId === line.orderId)}`;
      if (!order || order.paymentMethod !== 'cod' || !REMITTABLE.includes(order.status)) {
        issues.push({ path, code: 'notRemittable' });
        continue;
      }
      const [already] = await tx
        .select({ id: codRemittanceOrders.remittanceId })
        .from(codRemittanceOrders)
        .where(eq(codRemittanceOrders.orderId, order.id))
        .limit(1);
      if (already) {
        issues.push({ path, code: 'alreadyRemitted' });
        continue;
      }
      if (line.amount > order.total - order.amountPaid) {
        issues.push({ path, code: 'exceedsDue' });
        continue;
      }
      if (issues.length > 0) continue;
      await tx
        .insert(codRemittanceOrders)
        .values({ remittanceId: remittance!.id, orderId: order.id, amount: line.amount });
      const payment = await insertSucceededAttempt(tx, {
        orderId: order.id,
        provider: 'cod',
        kind: 'balance',
        amount: line.amount,
        providerTxnId: remittance!.id,
        confirmedBy: ctx.actor.id,
        raw: { remittanceId: remittance!.id, line: index },
      });
      await applySucceededPayment(tx, ctx.boss, {
        order,
        payment,
        confirmedBy: ctx.actor.id,
        actor: staffActor(ctx),
      });
    }
    if (issues.length > 0) throw new DomainError('invalid', issues);

    const check = remittanceDifference({
      orderAmounts: input.orders.map((o) => o.amount),
      carrierFee: input.carrierFee,
      totalAmount: input.totalAmount,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'payment.cod_remittance',
      entityType: 'cod_remittance',
      entityId: remittance!.id,
      diff: {
        carrier: input.carrier,
        orders: input.orders.length,
        totalAmount: input.totalAmount,
        carrierFee: input.carrierFee,
        expected: check.expected,
        difference: check.difference,
      },
      ip: ctx.ip,
    });
    return { data: { remittanceId: remittance!.id, ...check }, tags: NO_TAGS };
  });
}

// ---------- Refunds (§3.5) ----------

const GATEWAY_PROVIDERS = ['vnpay', 'payos'] as const;

export async function requestRefund(
  ctx: CommandContext,
  input: RequestRefundInput,
): Promise<CommandResult<{ refundId: string }>> {
  assertCan(ctx.actor, 'payments.refund');
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    const available = refundableAmount(order, await openRefundTotal(tx, order.id));
    if (input.amount > available) throw field('amount', 'exceedsRefundable');

    let paymentId = input.paymentId ?? null;
    if (paymentId) {
      const [payment] = await tx
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.orderId, order.id)));
      if (!payment || payment.status !== 'succeeded') throw field('paymentId', 'invalid');
    } else if (input.method === 'gateway') {
      const [payment] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.orderId, order.id),
            eq(payments.status, 'succeeded'),
            inArray(payments.provider, [...GATEWAY_PROVIDERS]),
            sql`${payments.amount} >= ${input.amount}`,
          ),
        )
        .orderBy(desc(payments.paidAt))
        .limit(1);
      if (!payment) throw field('method', 'noGatewayPayment');
      paymentId = payment.id;
    }

    const refundId = await queueRefund(tx, {
      orderId: order.id,
      paymentId,
      amount: input.amount,
      reason: input.reason,
      method: input.method,
      actorId: ctx.actor.id,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'refund.request',
      entityType: 'order',
      entityId: order.id,
      diff: { refundId, amount: input.amount, method: input.method },
      ip: ctx.ip,
    });
    return { data: { refundId }, tags: NO_TAGS };
  });
}

type RefundRow = typeof refunds.$inferSelect;

async function lockRefund(tx: Tx, refundId: string): Promise<RefundRow> {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
  if (!refund) throw new DomainError('notFound');
  return refund;
}

async function finishRefund(
  ctx: CommandContext,
  refundId: string,
  values: { providerRef: string | null; proofMediaId: string | null; mode: 'gateway' | 'manual' },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ orderId: refunds.orderId })
      .from(refunds)
      .where(eq(refunds.id, refundId));
    if (!peek) throw new DomainError('notFound');
    const order = await lockOrder(tx, peek.orderId);
    const refund = await lockRefund(tx, refundId);
    if (refund.status === 'completed') throw field('refundId', 'refundClosed');
    if (order.amountRefunded + refund.amount > order.amountPaid) {
      throw field('refundId', 'exceedsRefundable');
    }
    await tx
      .update(refunds)
      .set({
        status: 'completed',
        completedAt: new Date(),
        providerRef: values.providerRef,
        proofMediaId: values.proofMediaId,
        actorId: refund.actorId ?? ctx.actor.id,
      })
      .where(eq(refunds.id, refund.id));
    const paymentStatus = await applyCompletedRefund(tx, {
      order,
      refund,
      actor: staffActor(ctx),
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'refund.complete',
      entityType: 'order',
      entityId: order.id,
      diff: {
        refundId: refund.id,
        amount: refund.amount,
        mode: values.mode,
        providerRef: values.providerRef,
        paymentStatus: { from: order.paymentStatus, to: paymentStatus },
      },
      ip: ctx.ip,
    });
    return paymentStatus;
  });
}

/**
 * Completes a queued refund. `gateway` calls the provider's refund API (VNPay) when the
 * adapter supports it; `manual` records a bank/cash refund with a reference or proof image.
 */
export async function completeRefund(
  ctx: CommandContext & { gateways: PaymentGateways },
  input: CompleteRefundInput,
): Promise<
  CommandResult<{ status: 'completed' | 'failed'; paymentStatus: string | null; error?: string }>
> {
  assertCan(ctx.actor, 'payments.refund');

  if (input.mode === 'manual') {
    if (!input.providerRef && !input.proofMediaId) throw field('providerRef', 'proofRequired');
    const paymentStatus = await finishRefund(ctx, input.refundId, {
      providerRef: input.providerRef,
      proofMediaId: input.proofMediaId ?? null,
      mode: 'manual',
    });
    return { data: { status: 'completed', paymentStatus }, tags: NO_TAGS };
  }

  // Gateway: claim the refund (processing) so two clicks never call the API twice.
  const claim = await ctx.db.transaction(async (tx) => {
    const refund = await lockRefund(tx, input.refundId);
    if (refund.status !== 'requested' && refund.status !== 'failed') {
      throw field('refundId', 'refundClosed');
    }
    if (!refund.paymentId) throw field('mode', 'gatewayUnsupported');
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId));
    const gateway =
      payment && (payment.provider === 'vnpay' || payment.provider === 'payos')
        ? ctx.gateways[payment.provider]
        : null;
    if (!payment || !gateway?.refund) throw field('mode', 'gatewayUnsupported');
    await tx.update(refunds).set({ status: 'processing' }).where(eq(refunds.id, refund.id));
    return { refund, payment, gateway };
  });

  const { refund, payment, gateway } = claim;
  const result = await gateway.refund!({
    txnRef: payment.txnRef,
    providerTxnId: payment.providerTxnId,
    amount: refund.amount,
    paymentAmount: payment.amount,
    transactionDate: payment.createdAt,
    reason: refund.reason,
    actor: ctx.actor.id,
    ipAddress: ctx.ip ?? '127.0.0.1',
    now: new Date(),
  }).catch((error: unknown) => {
    logger.error('payment.refund.gateway_failed', { refundId: refund.id, ...errorFields(error) });
    return { ok: false as const, error: 'unexpected', raw: null };
  });

  if (!result.ok) {
    await ctx.db.transaction(async (tx) => {
      await tx.update(refunds).set({ status: 'failed' }).where(eq(refunds.id, refund.id));
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: 'refund.gateway_failed',
        entityType: 'order',
        entityId: refund.orderId,
        diff: { refundId: refund.id, error: result.error },
        ip: ctx.ip,
      });
    });
    return { data: { status: 'failed', paymentStatus: null, error: result.error }, tags: NO_TAGS };
  }
  const paymentStatus = await finishRefund(ctx, refund.id, {
    providerRef: result.providerRef,
    proofMediaId: null,
    mode: 'gateway',
  });
  return { data: { status: 'completed', paymentStatus }, tags: NO_TAGS };
}
