import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderEvents, orderItems, orders } from '@/server/db/schema';
import { EinvoiceError, type IssuedEinvoice } from '@/server/integrations/einvoice';
import { enqueue } from '@/server/jobs/queue';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { errorFields, logger } from '@/server/lib/logger';
import {
  orderTags,
  recordEinvoiceReplaced,
  recordOrderEvent,
  type OrderActor,
} from '@/server/modules/order';
import { getEinvoiceSettings } from '@/server/modules/settings';

import { invoiceAfterReturns } from './after-returns';
import { buildEinvoiceDocument } from './build';
import { invoiceLabels, returnAdjustmentReason } from './labels';
import type { EinvoiceAdjustInput } from './schemas';
import {
  acceptedReturns,
  classify,
  einvoiceEvents,
  einvoiceRef,
  EinvoiceRetryError,
  lockInvoicing,
  shippingLine,
  type EinvoiceDeps,
} from './service';
import {
  EINVOICE_ADJUSTMENT_EVENT_TYPES,
  EINVOICE_ADJUSTMENT_EVENTS,
  EINVOICE_EVENTS,
  EINVOICE_MAX_ATTEMPTS,
  einvoiceAdjustmentStatus,
  type EinvoiceAdjustmentAction,
  type EinvoiceAdjustmentEventRow,
  type EinvoiceEventRow,
} from './state';

/*
 * Cancellation and replacement of an issued e-invoice (Decree 123/2020 as amended by Decree
 * 70/2025; ADR-0013, ADR-0017). Requested by a received customer return (everything back →
 * cancel; part of it → replacement for what the customer kept) or by staff from the order's
 * e-invoice panel (`payments.refund`, audited). The provider is called only from the
 * `einvoice.adjust` outbox job, never inside a staff request:
 * - one invoicing operation per order at a time (the same advisory lock as issuing);
 * - idempotent: a cancellation first asks the provider whether the invoice is already
 *   cancelled; a replacement carries its own refId (stored with the request), so a retry finds
 *   the replacement issued by an earlier try instead of issuing a second one;
 * - each failed try is a timeline event; retryable failures are retried by pg-boss with backoff
 *   (same policy as issuing); after EINVOICE_MAX_ATTEMPTS, or at once for a permanent error,
 *   `einvoice_adjust_failed` + a `staff.alert` (`einvoice_adjustment_failed`).
 * Which documents the accountant uses for returns (replacement vs adjustment invoice, and
 * whether a change-of-mind return keeps the shipping fee invoiced) is PENDING ACCOUNTANT
 * CONFIRMATION, like the template and series (ADR-0013).
 */

const SYSTEM: OrderActor = { type: 'system', id: null };

export async function einvoiceAdjustmentEvents(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<EinvoiceAdjustmentEventRow[]> {
  const rows = await db
    .select({
      type: orderEvents.type,
      message: orderEvents.message,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        inArray(orderEvents.type, [...EINVOICE_ADJUSTMENT_EVENT_TYPES]),
      ),
    )
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
  return rows.map((row) => ({
    ...row,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  }));
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * The invoice currently standing for the order: the latest issued or replacement invoice,
 * rebuilt from its timeline metadata (provider ids are needed to cancel or replace it).
 */
export function currentIssuedInvoice(
  orderId: string,
  issueEvents: readonly EinvoiceEventRow[],
  adjustmentEvents: readonly EinvoiceAdjustmentEventRow[],
): IssuedEinvoice | null {
  const candidates = [
    ...issueEvents.filter((e) => e.type === EINVOICE_EVENTS.issued),
    ...adjustmentEvents.filter((e) => e.type === EINVOICE_ADJUSTMENT_EVENTS.replaced),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = candidates.at(-1);
  if (!latest) return null;
  const meta = latest.metadata ?? {};
  const invoiceNo = str(meta.invoiceNo);
  const series = str(meta.series);
  const provider = str(meta.provider);
  if (
    !invoiceNo ||
    !series ||
    (provider !== 'sandbox' && provider !== 'misa' && provider !== 'viettel')
  ) {
    return null;
  }
  const issuedAt = str(meta.issuedAt);
  return {
    provider,
    refId: str(meta.refId) ?? orderId,
    invoiceNo,
    series,
    templateCode: str(meta.templateCode),
    transactionId: str(meta.transactionId),
    lookupCode: str(meta.lookupCode),
    issuedAt: issuedAt ? new Date(issuedAt) : latest.createdAt,
  };
}

/** Order snapshot minus accepted returns, ready for `buildEinvoiceDocument`. */
async function effectiveInvoiceInput(tx: Pick<Tx, 'select'>, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const [shipping] = await tx
    .select()
    .from(orderAddresses)
    .where(and(eq(orderAddresses.orderId, orderId), eq(orderAddresses.type, 'shipping')))
    .limit(1);
  const kept = invoiceAfterReturns(order, items, await acceptedReturns(tx, orderId));
  return { order, kept, shippingAddress: shippingLine(shipping) };
}

export type AdjustmentRequest = {
  orderId: string;
  action: EinvoiceAdjustmentAction;
  reason: string;
  source: 'return' | 'staff';
  actor: OrderActor;
};

/**
 * Records the request and enqueues `einvoice.adjust` in the caller's transaction (outbox).
 * Refused when the order has no invoice, it is already cancelled, or staff ask while another
 * adjustment is still running (a return may queue behind a running one: the job always works
 * on the invoice standing when it runs).
 */
export async function requestEinvoiceAdjustment(
  tx: Tx,
  boss: PgBoss,
  input: AdjustmentRequest,
): Promise<{ adjustmentId: string; tags: string[] }> {
  await lockInvoicing(tx, input.orderId);
  const [order] = await tx
    .select({ id: orders.id, einvoiceRef: orders.einvoiceRef })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!order) throw new DomainError('notFound');
  if (!order.einvoiceRef) {
    throw new DomainError('invalid', [{ path: 'einvoice', code: 'noInvoice' }]);
  }
  const status = einvoiceAdjustmentStatus(order, await einvoiceAdjustmentEvents(tx, order.id));
  if (status.state === 'cancelled') {
    throw new DomainError('invalid', [{ path: 'einvoice', code: 'invoiceCancelled' }]);
  }
  if (!status.canAdjust && input.source === 'staff') {
    throw new DomainError('invalid', [{ path: 'einvoice', code: 'adjustmentRunning' }]);
  }
  const adjustmentId = newId();
  await recordOrderEvent(tx, {
    orderId: order.id,
    type: EINVOICE_ADJUSTMENT_EVENTS.requested,
    message: input.reason,
    actor: input.actor,
    metadata: {
      adjustmentId,
      action: input.action,
      source: input.source,
      previousRef: order.einvoiceRef,
      // The replacement's own idempotency key at the provider (MISA RefID, Viettel uuid).
      refId: input.action === 'replace' ? newId() : null,
    },
  });
  await enqueue(boss, tx, 'einvoice.adjust', { orderId: order.id, adjustmentId });
  const tags = await enqueueRevalidation(boss, tx, [orderTags.order(order.id), orderTags.list]);
  return { adjustmentId, tags };
}

/**
 * After a received return: cancel the invoice when nothing invoiced remains, otherwise replace
 * it with what the customer kept. Nothing when no invoice was issued (issuing later invoices
 * only the kept goods) or it is already cancelled.
 */
export async function requestEinvoiceAfterReturn(
  tx: Tx,
  boss: PgBoss,
  input: { orderId: string; orderCode: string; actor: OrderActor },
): Promise<{ adjustmentId: string; action: EinvoiceAdjustmentAction } | null> {
  const [order] = await tx
    .select({ einvoiceRef: orders.einvoiceRef })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!order?.einvoiceRef) return null;
  const status = einvoiceAdjustmentStatus(order, await einvoiceAdjustmentEvents(tx, input.orderId));
  if (status.state === 'cancelled') return null;
  const effective = await effectiveInvoiceInput(tx, input.orderId);
  if (!effective) return null;
  const action: EinvoiceAdjustmentAction = effective.kept.order.total > 0 ? 'replace' : 'cancel';
  const { adjustmentId } = await requestEinvoiceAdjustment(tx, boss, {
    orderId: input.orderId,
    action,
    reason: returnAdjustmentReason(input.orderCode),
    source: 'return',
    actor: input.actor,
  });
  return { adjustmentId, action };
}

async function staffAdjustment(
  ctx: CommandContext,
  input: EinvoiceAdjustInput,
  action: EinvoiceAdjustmentAction,
): Promise<CommandResult<{ orderId: string; adjustmentId: string }>> {
  assertCan(ctx.actor, 'payments.refund');
  return ctx.db.transaction(async (tx) => {
    const { adjustmentId, tags } = await requestEinvoiceAdjustment(tx, ctx.boss, {
      orderId: input.orderId,
      action,
      reason: input.reason,
      source: 'staff',
      actor: { type: 'staff', id: ctx.actor.id },
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: action === 'cancel' ? 'order.einvoice_cancel' : 'order.einvoice_replace',
      entityType: 'order',
      entityId: input.orderId,
      diff: { adjustmentId, reason: { from: null, to: input.reason } },
      ip: ctx.ip,
    });
    return { data: { orderId: input.orderId, adjustmentId }, tags };
  });
}

/** Staff: "Huỷ hoá đơn" (Owner/Manager, `payments.refund`). */
export function cancelEinvoice(ctx: CommandContext, input: EinvoiceAdjustInput) {
  return staffAdjustment(ctx, input, 'cancel');
}

/** Staff: "Lập hoá đơn thay thế" for the current order (after returns), same permission. */
export function replaceEinvoice(ctx: CommandContext, input: EinvoiceAdjustInput) {
  return staffAdjustment(ctx, input, 'replace');
}

export type AdjustmentOutcome =
  | { outcome: 'cancelled' | 'replaced'; ref: string }
  | { outcome: 'skipped'; reason: 'missing' | 'done' | 'invoice_cancelled' }
  | { outcome: 'retry' | 'failed'; reason: string; attempt: number };

export async function adjustOrderEinvoice(
  deps: EinvoiceDeps,
  input: { orderId: string; adjustmentId: string },
): Promise<AdjustmentOutcome> {
  const now = deps.now ?? (() => new Date());
  const { orderId, adjustmentId } = input;
  return deps.db.transaction(async (tx): Promise<AdjustmentOutcome> => {
    await lockInvoicing(tx, orderId);
    const [order] = await tx
      .select({ id: orders.id, code: orders.code, einvoiceRef: orders.einvoiceRef })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return { outcome: 'skipped', reason: 'missing' };
    const adjustments = await einvoiceAdjustmentEvents(tx, orderId);
    const mine = adjustments.filter((e) => e.metadata?.adjustmentId === adjustmentId);
    const request = mine.find((e) => e.type === EINVOICE_ADJUSTMENT_EVENTS.requested);
    if (!request) return { outcome: 'skipped', reason: 'missing' };
    const finished: readonly string[] = [
      EINVOICE_ADJUSTMENT_EVENTS.cancelled,
      EINVOICE_ADJUSTMENT_EVENTS.replaced,
      EINVOICE_ADJUSTMENT_EVENTS.failed,
    ];
    if (mine.some((e) => finished.includes(e.type))) return { outcome: 'skipped', reason: 'done' };
    if (adjustments.some((e) => e.type === EINVOICE_ADJUSTMENT_EVENTS.cancelled)) {
      return { outcome: 'skipped', reason: 'invoice_cancelled' };
    }
    const action = request.metadata?.action === 'cancel' ? 'cancel' : 'replace';
    const reasonText = request.message ?? returnAdjustmentReason(order.code);
    const attempt =
      mine.filter((e) => e.type === EINVOICE_ADJUSTMENT_EVENTS.attemptFailed).length + 1;

    try {
      if (!deps.provider) throw new EinvoiceError('not_configured', false);
      const provider = deps.provider;
      const current = currentIssuedInvoice(orderId, await einvoiceEvents(tx, orderId), adjustments);
      if (!current || !order.einvoiceRef) throw new EinvoiceError('no_invoice', false);

      if (action === 'cancel') {
        const found = await provider.lookup(current.refId);
        if (found.status !== 'cancelled') await provider.cancel(current, reasonText);
        const ref = einvoiceRef(current);
        await recordOrderEvent(tx, {
          orderId,
          type: EINVOICE_ADJUSTMENT_EVENTS.cancelled,
          actor: SYSTEM,
          metadata: { adjustmentId, ref, provider: current.provider, attempt },
        });
        await enqueueRevalidation(deps.boss, tx, [orderTags.order(orderId), orderTags.list]);
        return { outcome: 'cancelled', ref };
      }

      const refId = str(request.metadata?.refId) ?? adjustmentId;
      const effective = await effectiveInvoiceInput(tx, orderId);
      if (!effective) throw new EinvoiceError('no_invoice', false);
      if (effective.kept.order.total <= 0) throw new EinvoiceError('nothing_to_invoice', false);
      const settings = await getEinvoiceSettings(tx);
      const document = {
        ...buildEinvoiceDocument({
          order: effective.kept.order,
          items: effective.kept.items,
          shippingAddress: effective.shippingAddress,
          vatRatePercent: settings.vatRatePercent,
          issueDate: now(),
          labels: deps.labels ?? invoiceLabels(),
        }),
        refId,
      };
      const existing = await provider.lookup(refId);
      const reused = existing.status !== 'not_found';
      const invoice =
        existing.status !== 'not_found'
          ? existing.invoice
          : await provider.replace(current, document, reasonText);
      const ref = einvoiceRef(invoice);
      const previousRef = order.einvoiceRef;
      if (
        !(await recordEinvoiceReplaced(tx, {
          orderId,
          previousRef,
          ref,
          issuedAt: invoice.issuedAt,
        }))
      ) {
        throw new EinvoiceError('ref_changed', false);
      }
      await recordOrderEvent(tx, {
        orderId,
        type: EINVOICE_ADJUSTMENT_EVENTS.replaced,
        actor: SYSTEM,
        metadata: {
          adjustmentId,
          previousRef,
          ref,
          refId,
          provider: invoice.provider,
          invoiceNo: invoice.invoiceNo,
          series: invoice.series,
          templateCode: invoice.templateCode,
          transactionId: invoice.transactionId,
          lookupCode: invoice.lookupCode,
          issuedAt: invoice.issuedAt.toISOString(),
          buyer: document.buyer.kind,
          total: document.totals.grossAmount,
          vatRate: settings.vatRatePercent,
          vatAmount: document.totals.vatAmount,
          attempt,
          reused,
        },
      });
      await enqueueRevalidation(deps.boss, tx, [orderTags.order(orderId), orderTags.list]);
      return { outcome: 'replaced', ref };
    } catch (error) {
      const { reason, retryable } = classify(error);
      const final = !retryable || attempt >= EINVOICE_MAX_ATTEMPTS;
      logger.warn('einvoice.adjust_attempt_failed', {
        orderId,
        action,
        attempt,
        reason,
        final,
        ...(reason === 'unexpected' ? errorFields(error) : {}),
      });
      await recordOrderEvent(tx, {
        orderId,
        type: final ? EINVOICE_ADJUSTMENT_EVENTS.failed : EINVOICE_ADJUSTMENT_EVENTS.attemptFailed,
        message: reason,
        actor: SYSTEM,
        metadata: {
          adjustmentId,
          action,
          reason,
          attempt,
          retryable,
          provider: deps.provider?.name ?? null,
        },
      });
      if (final) {
        await enqueue(deps.boss, tx, 'staff.alert', {
          kind: 'einvoice_adjustment_failed',
          orderId,
          message: `E-invoice ${action === 'cancel' ? 'cancellation' : 'replacement'} failed after ${attempt} attempt(s): ${reason}. Request it again from the order page or do it in the provider portal.`,
        });
        await enqueueRevalidation(deps.boss, tx, [orderTags.order(orderId), orderTags.list]);
      }
      return { outcome: final ? 'failed' : 'retry', reason, attempt };
    }
  });
}

/** Job handler body: throws outside the transaction when a retry is due (pg-boss backoff). */
export async function runEinvoiceAdjustmentJob(
  deps: EinvoiceDeps,
  input: { orderId: string; adjustmentId: string },
): Promise<AdjustmentOutcome> {
  const result = await adjustOrderEinvoice(deps, input);
  if (result.outcome === 'retry') throw new EinvoiceRetryError(result.reason);
  return result;
}
