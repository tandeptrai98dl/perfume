import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orderAddresses, orderEvents, orderItems, orders } from '@/server/db/schema';
import {
  EinvoiceError,
  type EinvoiceProvider,
  type IssuedEinvoice,
} from '@/server/integrations/einvoice';
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
import { errorFields, logger } from '@/server/lib/logger';
import {
  orderTags,
  parseReturnReceived,
  recordEinvoiceIssued,
  recordOrderEvent,
  RETURN_EVENTS,
  type ReturnReceivedMetadata,
} from '@/server/modules/order';
import { getEinvoiceSettings } from '@/server/modules/settings';

import { invoiceAfterReturns } from './after-returns';
import { buildEinvoiceDocument, InvoiceBuildError, type InvoiceLabels } from './build';
import { invoiceLabels } from './labels';
import type { EinvoiceRetryInput } from './schemas';
import {
  attemptsSinceRetry,
  EINVOICE_ELIGIBLE_STATUSES,
  EINVOICE_EVENT_TYPES,
  EINVOICE_EVENTS,
  EINVOICE_MAX_ATTEMPTS,
  einvoiceStatus,
  type EinvoiceEventRow,
} from './state';

/*
 * Automatic e-invoice per delivered order (D13, ADR-0013, ARCHITECTURE §3.4 step 9).
 * `issueOrderEinvoice` runs in the worker for the `einvoice.issue` outbox job:
 * - one issuer per order at a time (transaction advisory lock; the order row is NOT locked, so
 *   invoicing never blocks order transitions while the provider is called);
 * - write-once `orders.einvoice_ref` (never issued twice): before issuing, the provider is asked
 *   for an invoice with our refId (= order id), which covers a crash between the provider's
 *   success and our commit;
 * - each failed try is a timeline event; retryable failures make the job throw so pg-boss
 *   retries with backoff; after EINVOICE_MAX_ATTEMPTS tries (or at once for a permanent error)
 *   the order is marked failed and staff get a `staff.alert` in the same transaction.
 * Event metadata and alerts carry codes only (no buyer data).
 */

const SYSTEM = { type: 'system' as const, id: null };

export type EinvoiceDeps = {
  db: Database;
  boss: PgBoss;
  /** null = no provider configured (production without EINVOICE_PROVIDER). */
  provider: EinvoiceProvider | null;
  now?: () => Date;
  labels?: InvoiceLabels;
};

export type IssueOutcome =
  | { outcome: 'issued'; ref: string; reused: boolean }
  | { outcome: 'skipped'; reason: 'missing' | 'already_issued' | 'not_eligible' }
  | { outcome: 'retry'; reason: string; attempt: number }
  | { outcome: 'failed'; reason: string; attempt: number };

/** Human-readable reference stored in `orders.einvoice_ref`: series + number. */
export function einvoiceRef(invoice: Pick<IssuedEinvoice, 'series' | 'invoiceNo'>): string {
  return `${invoice.series}-${invoice.invoiceNo}`;
}

export async function lockInvoicing(tx: Tx, orderId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`einvoice:${orderId}`}, 0))`,
  );
}

export async function einvoiceEvents(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<EinvoiceEventRow[]> {
  const rows = await db
    .select({
      type: orderEvents.type,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(
      and(eq(orderEvents.orderId, orderId), inArray(orderEvents.type, [...EINVOICE_EVENT_TYPES])),
    )
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
  return rows.map((row) => ({
    ...row,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  }));
}

/** Accepted customer returns of the order (`return_received` events), oldest first. */
export async function acceptedReturns(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<ReturnReceivedMetadata[]> {
  const rows = await db
    .select({ metadata: orderEvents.metadata })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, RETURN_EVENTS.received)))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
  return rows
    .map((row) => parseReturnReceived(row.metadata))
    .filter((row): row is ReturnReceivedMetadata => row !== null);
}

export function shippingLine(
  address: { street: string; wardName: string; provinceName: string } | undefined,
) {
  return address
    ? [address.street, address.wardName, address.provinceName].filter(Boolean).join(', ')
    : null;
}

export function classify(error: unknown): { reason: string; retryable: boolean } {
  if (error instanceof EinvoiceError) return { reason: error.reason, retryable: error.retryable };
  if (error instanceof InvoiceBuildError) return { reason: error.reason, retryable: false };
  return { reason: 'unexpected', retryable: true };
}

export async function issueOrderEinvoice(
  deps: EinvoiceDeps,
  orderId: string,
): Promise<IssueOutcome> {
  const now = deps.now ?? (() => new Date());
  return deps.db.transaction(async (tx): Promise<IssueOutcome> => {
    await lockInvoicing(tx, orderId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return { outcome: 'skipped', reason: 'missing' };
    if (order.einvoiceRef) return { outcome: 'skipped', reason: 'already_issued' };
    if (!EINVOICE_ELIGIBLE_STATUSES.includes(order.status)) {
      return { outcome: 'skipped', reason: 'not_eligible' };
    }
    const attempt = attemptsSinceRetry(await einvoiceEvents(tx, orderId)) + 1;

    try {
      if (!deps.provider) throw new EinvoiceError('not_configured', false);
      const provider = deps.provider;
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
      const settings = await getEinvoiceSettings(tx);
      // Lines already returned (ADR-0017) are not invoiced (invoice issued after a return).
      const kept = invoiceAfterReturns(order, items, await acceptedReturns(tx, orderId));
      const document = buildEinvoiceDocument({
        order: kept.order,
        items: kept.items,
        shippingAddress: shippingLine(shipping),
        vatRatePercent: settings.vatRatePercent,
        issueDate: now(),
        labels: deps.labels ?? invoiceLabels(),
      });

      // Duplicate guard: an earlier try may have succeeded at the provider.
      const existing = await provider.lookup(document.refId);
      const reused = existing.status !== 'not_found';
      const invoice =
        existing.status !== 'not_found' ? existing.invoice : await provider.issue(document);

      const ref = einvoiceRef(invoice);
      await recordEinvoiceIssued(tx, { orderId, ref, issuedAt: invoice.issuedAt });
      await recordOrderEvent(tx, {
        orderId,
        type: EINVOICE_EVENTS.issued,
        actor: SYSTEM,
        metadata: {
          ref,
          provider: invoice.provider,
          invoiceNo: invoice.invoiceNo,
          series: invoice.series,
          templateCode: invoice.templateCode,
          transactionId: invoice.transactionId,
          lookupCode: invoice.lookupCode,
          issuedAt: invoice.issuedAt.toISOString(),
          buyer: document.buyer.kind,
          vatRate: settings.vatRatePercent,
          vatAmount: document.totals.vatAmount,
          attempt,
          reused,
        },
      });
      await enqueueRevalidation(deps.boss, tx, [orderTags.order(orderId), orderTags.list]);
      return { outcome: 'issued', ref, reused };
    } catch (error) {
      const { reason, retryable } = classify(error);
      const final = !retryable || attempt >= EINVOICE_MAX_ATTEMPTS;
      logger.warn('einvoice.attempt_failed', {
        orderId,
        attempt,
        reason,
        final,
        ...(reason === 'unexpected' ? errorFields(error) : {}),
      });
      await recordOrderEvent(tx, {
        orderId,
        type: final ? EINVOICE_EVENTS.failed : EINVOICE_EVENTS.attemptFailed,
        message: reason,
        actor: SYSTEM,
        metadata: { reason, attempt, retryable, provider: deps.provider?.name ?? null },
      });
      if (final) {
        await enqueue(deps.boss, tx, 'staff.alert', {
          kind: 'einvoice_failed',
          orderId,
          message: `E-invoice not issued after ${attempt} attempt(s): ${reason}. Retry from the order page or issue it in the provider portal.`,
        });
        await enqueueRevalidation(deps.boss, tx, [orderTags.order(orderId), orderTags.list]);
      }
      return { outcome: final ? 'failed' : 'retry', reason, attempt };
    }
  });
}

/** Thrown after the attempt was recorded, so pg-boss retries the job with backoff. */
export class EinvoiceRetryError extends Error {
  constructor(public readonly reason: string) {
    super(`E-invoice attempt failed (${reason}); retrying`);
    this.name = 'EinvoiceRetryError';
  }
}

/** Job handler body: issue, and throw outside the transaction when a retry is due. */
export async function runEinvoiceJob(deps: EinvoiceDeps, orderId: string): Promise<IssueOutcome> {
  const result = await issueOrderEinvoice(deps, orderId);
  if (result.outcome === 'retry') throw new EinvoiceRetryError(result.reason);
  return result;
}

/**
 * Staff retry from the order page or the failed list (`orders.process`): records the request
 * (attempts restart), audits it and enqueues a new `einvoice.issue` job. Refused when the
 * invoice exists, the order is not delivered, or a try is already scheduled.
 */
export async function retryEinvoice(
  ctx: CommandContext,
  input: EinvoiceRetryInput,
): Promise<CommandResult<{ orderId: string }>> {
  assertCan(ctx.actor, 'orders.process');
  return ctx.db.transaction(async (tx) => {
    await lockInvoicing(tx, input.orderId);
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        deliveredAt: orders.deliveredAt,
        einvoiceRef: orders.einvoiceRef,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    if (!order) throw new DomainError('notFound');
    const status = einvoiceStatus(order, await einvoiceEvents(tx, order.id));
    if (!status.canRetry) {
      throw new DomainError('invalid', [{ path: 'einvoice', code: 'notRetryable' }]);
    }
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: EINVOICE_EVENTS.retryRequested,
      actor: { type: 'staff', id: ctx.actor.id },
      metadata: { previousState: status.state, previousReason: status.reason },
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.einvoice_retry',
      entityType: 'order',
      entityId: order.id,
      diff: { einvoiceState: { from: status.state, to: 'pending' } },
      ip: ctx.ip,
    });
    await enqueue(ctx.boss, tx, 'einvoice.issue', { orderId: order.id });
    const tags = await enqueueRevalidation(ctx.boss, tx, [
      orderTags.order(order.id),
      orderTags.list,
    ]);
    return { data: { orderId: order.id }, tags };
  });
}
