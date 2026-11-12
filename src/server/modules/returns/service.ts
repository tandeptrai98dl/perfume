import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orderEvents, orderItems } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  can,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { requestEinvoiceAfterReturn } from '@/server/modules/einvoice';
import {
  adjustOrderStock,
  restockReturnedLines,
  writeOffReturnedStock,
} from '@/server/modules/inventory';
import {
  lockOrder,
  orderTags,
  recordOrderEvent,
  RETURN_EVENT_TYPES,
  RETURN_EVENTS,
  staffOrderActor,
  transitionOrder,
  type OrderActor,
  type ReturnReceivedMetadata,
} from '@/server/modules/order';
import { queueReturnRefund } from '@/server/modules/payment';
import { getCommerceSettings } from '@/server/modules/settings';

import {
  foldReturnEvents,
  planReturnRefund,
  resolutionsFor,
  returnEligibility,
  validateReturnLines,
  type ReturnEventRow,
  type ReturnOrderLine,
  type ReturnState,
} from './rules';
import type {
  ApproveReturnInput,
  ReceiveReturnInput,
  RejectReturnInput,
  ReturnRequestInput,
} from './schemas';

/*
 * Customer returns (ADR-0017, ARCHITECTURE §3.5, §10.5, §11.2). The order stays the record:
 * status changes go through `transitionOrder`, the request and every decision are
 * `order_events` (no extra table), stock through the inventory module, money through the
 * payment module's refund queue, the e-invoice through the einvoice module, e-mails and
 * staff alerts through outbox jobs — all in the transaction of the change.
 *
 * Flow: customer request (`delivered → return_requested`) → staff approve (note e-mailed) or
 * reject (`→ delivered`, reason e-mailed) → staff receive the parcel:
 * - refund, everything back: `→ returned` (transitionOrder restocks the whole order);
 * - refund, part of it: the lines are restocked here and the order goes back to `delivered`
 *   (the state machine has no partial "returned"; `orders.complete-delivered` completes it
 *   when the window has passed, counted from the original delivery);
 * - replacement (shop's fault): the order goes back to `delivered` and the replacement units
 *   are deducted from stock for the same order; nothing is refunded.
 * Units that cannot be sold again are written off (`damage`) right after the restock.
 */

const MANAGE_PERMISSION = 'payments.refund' as const;

export async function returnEvents(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<ReturnEventRow[]> {
  return db
    .select({
      id: orderEvents.id,
      type: orderEvents.type,
      message: orderEvents.message,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(
      and(eq(orderEvents.orderId, orderId), inArray(orderEvents.type, [...RETURN_EVENT_TYPES])),
    )
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
}

async function orderLines(
  db: Pick<Database, 'select'>,
  orderId: string,
): Promise<ReturnOrderLine[]> {
  return db
    .select({
      id: orderItems.id,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
}

function invalid(code: string, path = 'return'): DomainError {
  return new DomainError('invalid', [{ path, code }]);
}

async function tagsFor(boss: PgBoss, tx: Tx, orderId: string) {
  return enqueueRevalidation(boss, tx, [orderTags.order(orderId), orderTags.list]);
}

// ---------- Customer request ----------

export type ReturnRequestResult = { requestId: string; orderId: string };

/**
 * A customer (member or guest with order access — checked by the caller) asks for a return.
 * Re-checks everything under the order row lock: status, window, one request per order, lines.
 */
export async function requestReturn(
  db: Database,
  boss: PgBoss,
  input: {
    orderId: string;
    /** Member id, or null for a guest with the signed order link / lookup cookie. */
    userId: string | null;
    values: ReturnRequestInput;
    now?: Date;
  },
): Promise<ReturnRequestResult> {
  const now = input.now ?? new Date();
  const { values } = input;
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    // One connection inside a transaction: sequential reads.
    const settings = await getCommerceSettings(tx);
    const events = await returnEvents(tx, order.id);
    const items = await orderLines(tx, order.id);
    const eligibility = returnEligibility({
      status: order.status,
      deliveredAt: order.deliveredAt,
      windowDays: settings.returnsWindowDays,
      now,
      hasRequest: foldReturnEvents(events) !== null,
    });
    if (!eligibility.eligible) throw invalid(eligibility.reason);
    const issues = validateReturnLines(items, values.lines);
    if (issues.length > 0) throw new DomainError('invalid', issues);
    if (!resolutionsFor(values.reason).includes(values.resolution)) {
      throw invalid('refundOnly', 'resolution');
    }

    const actor: OrderActor = { type: 'customer', id: input.userId };
    const requestId = newId();
    await transitionOrder(tx, boss, {
      orderId: order.id,
      to: 'return_requested',
      actor,
      reason: values.reason,
      metadata: { requestId },
    });
    const estimate = planReturnRefund({
      items,
      lines: values.lines,
      reason: values.reason,
      resolution: values.resolution,
      shippingFee: order.shippingFee,
      giftWrapFee: order.giftWrapFee,
    });
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: RETURN_EVENTS.requested,
      // The customer's own words (free text; removed when the customer is anonymised).
      message: values.description || null,
      actor,
      metadata: {
        requestId,
        reason: values.reason,
        resolution: values.resolution,
        lines: values.lines,
        sealIntact: values.sealIntact,
        estimatedRefund: estimate.total,
      },
    });
    await enqueue(boss, tx, 'return.notify', { orderId: order.id, requestId, kind: 'requested' });
    const units = values.lines.reduce((sum, line) => sum + line.quantity, 0);
    await enqueue(boss, tx, 'staff.alert', {
      kind: 'return_requested',
      orderId: order.id,
      message: `Return requested: ${units} unit(s), reason ${values.reason}, resolution ${values.resolution}. Estimated refund ${estimate.total} VND.`,
    });
    await tagsFor(boss, tx, order.id);
    return { requestId, orderId: order.id };
  });
}

// ---------- Staff decisions ----------

async function lockReturn(tx: Tx, orderId: string, requestId: string) {
  const order = await lockOrder(tx, orderId);
  const state = foldReturnEvents(await returnEvents(tx, orderId));
  if (!state || state.requestId !== requestId) throw new DomainError('notFound');
  return { order, state };
}

export type ReturnCommandResult = {
  orderId: string;
  requestId: string;
  status: ReturnState['status'];
};

/** Accept the request: the customer is told how to send the goods back (Owner/Manager). */
export async function approveReturn(
  ctx: CommandContext,
  input: ApproveReturnInput,
): Promise<CommandResult<ReturnCommandResult>> {
  assertCan(ctx.actor, MANAGE_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const { order, state } = await lockReturn(tx, input.orderId, input.requestId);
    if (order.status !== 'return_requested' || state.status !== 'requested') {
      throw invalid('notPending');
    }
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: RETURN_EVENTS.approved,
      message: input.note,
      actor: staffOrderActor(ctx.actor),
      metadata: { requestId: state.requestId },
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.return_approve',
      entityType: 'order',
      entityId: order.id,
      diff: { returnStatus: { from: 'requested', to: 'approved' }, requestId: state.requestId },
      ip: ctx.ip,
    });
    await enqueue(ctx.boss, tx, 'return.notify', {
      orderId: order.id,
      requestId: state.requestId,
      kind: 'approved',
    });
    const tags = await tagsFor(ctx.boss, tx, order.id);
    return { data: { orderId: order.id, requestId: state.requestId, status: 'approved' }, tags };
  });
}

/** Refuse the request (reason e-mailed): the order goes back to `delivered`. */
export async function rejectReturn(
  ctx: CommandContext,
  input: RejectReturnInput,
): Promise<CommandResult<ReturnCommandResult>> {
  assertCan(ctx.actor, MANAGE_PERMISSION);
  return ctx.db.transaction(async (tx) => {
    const { order, state } = await lockReturn(tx, input.orderId, input.requestId);
    if (
      order.status !== 'return_requested' ||
      (state.status !== 'requested' && state.status !== 'approved')
    ) {
      throw invalid('notPending');
    }
    const actor = staffOrderActor(ctx.actor);
    await transitionOrder(tx, ctx.boss, {
      orderId: order.id,
      to: 'delivered',
      actor,
      reason: 'return_rejected',
      metadata: { requestId: state.requestId },
    });
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: RETURN_EVENTS.rejected,
      message: input.reason,
      actor,
      metadata: { requestId: state.requestId },
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.return_reject',
      entityType: 'order',
      entityId: order.id,
      diff: {
        returnStatus: { from: state.status, to: 'rejected' },
        reason: { from: null, to: input.reason },
        requestId: state.requestId,
      },
      ip: ctx.ip,
    });
    await enqueue(ctx.boss, tx, 'return.notify', {
      orderId: order.id,
      requestId: state.requestId,
      kind: 'rejected',
    });
    const tags = await tagsFor(ctx.boss, tx, order.id);
    return { data: { orderId: order.id, requestId: state.requestId, status: 'rejected' }, tags };
  });
}

export type ReceiveReturnResult = ReturnCommandResult & {
  outcome: ReturnReceivedMetadata['outcome'];
  refund: ReturnReceivedMetadata['refund'];
  einvoice: 'cancel' | 'replace' | null;
};

/**
 * The parcel came back (`orders.process`; a return-shipping reimbursement also needs
 * `payments.refund`): stock, refund queue, order status, e-invoice, customer e-mail.
 */
export async function receiveReturn(
  ctx: CommandContext,
  input: ReceiveReturnInput,
): Promise<CommandResult<ReceiveReturnResult>> {
  assertCan(ctx.actor, 'orders.process');
  if (input.returnShippingFee > 0 && !can(ctx.actor, MANAGE_PERMISSION)) {
    throw new DomainError('forbidden', [{ path: 'returnShippingFee', code: 'refundForbidden' }]);
  }
  return ctx.db.transaction(async (tx) => {
    const { order, state } = await lockReturn(tx, input.orderId, input.requestId);
    if (order.status !== 'return_requested' || state.status !== 'approved') {
      throw invalid(state.status === 'requested' ? 'notApproved' : 'notPending');
    }
    const items = await orderLines(tx, order.id);
    const plan = planReturnRefund({
      items,
      lines: state.lines,
      reason: state.reason,
      resolution: state.resolution,
      shippingFee: order.shippingFee,
      giftWrapFee: order.giftWrapFee,
      returnShippingFee: input.returnShippingFee,
    });
    const actor = staffOrderActor(ctx.actor);
    const stockLines = plan.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
    }));
    const note = `return ${state.requestId}`;

    // The returned units come back (movement `return`) for what the order holds; for a full
    // return `transitionOrder(→ returned)` then finds nothing left to restock.
    const restocked = await restockReturnedLines(tx, {
      orderId: order.id,
      lines: stockLines,
      actorId: ctx.actor.id,
      note,
    });
    if (!input.resellable) {
      await writeOffReturnedStock(tx, {
        orderId: order.id,
        lines: restocked,
        actorId: ctx.actor.id,
        note: `${note}: not resellable`,
      });
    }
    if (plan.outcome === 'full') {
      await transitionOrder(tx, ctx.boss, {
        orderId: order.id,
        to: 'returned',
        actor,
        reason: 'return_received',
        metadata: { requestId: state.requestId },
      });
    }
    if (plan.outcome === 'replacement') {
      // The replacement units leave stock for the same order (movement `sale`).
      await adjustOrderStock(tx, {
        orderId: order.id,
        mode: 'committed',
        changes: stockLines.map((line) => ({ variantId: line.variantId, delta: line.quantity })),
        actorId: ctx.actor.id,
        note: `${note}: replacement`,
      });
    }
    if (plan.outcome !== 'full') {
      await transitionOrder(tx, ctx.boss, {
        orderId: order.id,
        to: 'delivered',
        actor,
        reason: plan.outcome === 'replacement' ? 'return_replaced' : 'return_partial',
        metadata: { requestId: state.requestId },
      });
    }

    const money = await queueReturnRefund(tx, ctx.boss, {
      orderId: order.id,
      amount: plan.total,
      actorId: ctx.actor.id,
      reason: `return:${state.reason}`,
    });
    const refund: ReturnReceivedMetadata['refund'] = {
      merchandise: plan.merchandise,
      shipping: plan.shipping,
      giftWrap: plan.giftWrap,
      returnShipping: plan.returnShipping,
      total: plan.total,
      refundId: money.refundId,
      queued: money.queued,
      shortfall: money.shortfall,
    };
    const metadata: ReturnReceivedMetadata = {
      requestId: state.requestId,
      outcome: plan.outcome,
      lines: plan.lines,
      feesRefunded: plan.feesRefunded,
      restocked: input.resellable,
      refund,
    };
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: RETURN_EVENTS.received,
      message: input.note,
      actor,
      metadata,
    });

    // E-invoice (D13): only for an invoice already issued; a replacement changes nothing.
    const einvoice =
      plan.outcome === 'replacement'
        ? null
        : await requestEinvoiceAfterReturn(tx, ctx.boss, {
            orderId: order.id,
            orderCode: order.code,
            actor,
          });

    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.return_receive',
      entityType: 'order',
      entityId: order.id,
      diff: {
        returnStatus: { from: 'approved', to: 'received' },
        requestId: state.requestId,
        outcome: plan.outcome,
        refund: { total: plan.total, queued: money.queued, shortfall: money.shortfall },
        resellable: input.resellable,
        einvoice: einvoice?.action ?? null,
      },
      ip: ctx.ip,
    });
    await enqueue(ctx.boss, tx, 'return.notify', {
      orderId: order.id,
      requestId: state.requestId,
      kind: 'received',
    });
    const tags = await tagsFor(ctx.boss, tx, order.id);
    return {
      data: {
        orderId: order.id,
        requestId: state.requestId,
        status: 'received',
        outcome: plan.outcome,
        refund,
        einvoice: einvoice?.action ?? null,
      },
      tags,
    };
  });
}
