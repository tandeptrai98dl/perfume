import { eq, inArray } from 'drizzle-orm';

import { orders, users } from '@/server/db/schema';
import { recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { createShipment, updateLatestShipmentStatus } from '@/server/modules/shipping';

import type {
  BulkOrdersInput,
  CancelOrderInput,
  OrderNoteInput,
  OrderTransitionInput,
  ShipOrderInput,
} from './admin-schemas';
import { depositSatisfied, staffOrderActor } from './admin-view';
import type { OrderStatus } from './state-machine';
import { lockOrder, recordOrderEvent, transitionOrder, type TransitionResult } from './transition';
import { queueRefundForCancelledOrder } from '@/server/modules/payment';

/*
 * Staff order commands (§11.2 Orders, ADR-0005). Every status change goes through
 * `transitionOrder` (row lock, version check, stock effects, timeline, outbox job); these
 * commands add the business guards around it (deposit, shipment, paid-cancel), the side
 * effects owned by the order flow (shipment row, COD risk flag), the audit row and the cache
 * tags. Manual orders and edits (wave 2) reuse `transitionInTx` and `orderTags`.
 */

/** Cache tags for cached order reads (account order pages, admin lists). */
export const orderTags = {
  list: 'orders:list',
  order: (id: string) => `order:${id}`,
} as const;

type GuardedTransition = {
  orderId: string;
  to: OrderStatus;
  expectedVersion?: number;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

type TransitionOutcome = TransitionResult & { code: string; tags: string[] };

/**
 * Guards + transition + side effects inside the caller's transaction. Exported for later admin
 * flows (manual order confirmation, edits) that must apply the same rules.
 */
export async function transitionInTx(
  ctx: CommandContext,
  tx: Tx,
  input: GuardedTransition,
): Promise<TransitionOutcome> {
  const actor = staffOrderActor(ctx.actor);
  const order = await lockOrder(tx, input.orderId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== order.version) {
    throw new DomainError('conflict');
  }

  // Customer returns (ADR-0017) have their own flow (request details, refund, restock of the
  // returned lines, e-invoice): the generic status buttons never open or close them.
  if (input.to === 'return_requested' || order.status === 'return_requested') {
    throw new DomainError('invalid', [{ path: 'status', code: 'useReturnFlow' }]);
  }
  if (input.to === 'confirmed' && order.status === 'awaiting_confirmation') {
    // D16: high-value COD orders need their online deposit before staff may confirm.
    if (!depositSatisfied(order)) {
      throw new DomainError('invalid', [{ path: 'status', code: 'depositRequired' }]);
    }
  }
  if (input.to === 'cancelled' && order.amountPaid > 0 && !actor.isManager) {
    // RBAC §11.1: cancelling an order that holds money (refund follows) is Manager/Owner only.
    throw new DomainError('forbidden', [{ path: 'status', code: 'cancelPaidForbidden' }]);
  }

  const result = await transitionOrder(tx, ctx.boss, {
    orderId: order.id,
    to: input.to,
    actor,
    reason: input.reason ?? undefined,
    expectedVersion: input.expectedVersion,
    metadata: input.metadata,
  });

  if (input.to === 'delivered') {
    await updateLatestShipmentStatus(tx, order.id, 'delivered');
  } else if (input.to === 'delivery_failed') {
    await updateLatestShipmentStatus(tx, order.id, 'failed');
    await flagCodRisk(ctx, tx, order);
  } else if (input.to === 'returned' && result.from === 'delivery_failed') {
    await updateLatestShipmentStatus(tx, order.id, 'returned');
  }
  if (input.to === 'cancelled' && order.amountPaid > order.amountRefunded) {
    // Money already received goes to the payments refund queue (payment module owns refunds).
    await queueRefundForCancelledOrder(tx, ctx.boss, {
      orderId: order.id,
      actorId: ctx.actor.id,
      reason: input.reason ?? 'order_cancelled',
    });
  }

  await recordAudit(tx, {
    actorId: ctx.actor.id,
    action: `order.status.${input.to}`,
    entityType: 'order',
    entityId: order.id,
    diff: {
      status: { from: result.from, to: result.to },
      version: { from: order.version, to: result.version },
      ...(input.reason ? { reason: { from: null, to: input.reason } } : {}),
    },
    ip: ctx.ip,
  });
  const tags = await enqueueRevalidation(ctx.boss, tx, [orderTags.list, orderTags.order(order.id)]);
  return { ...result, code: order.code, tags };
}

/**
 * Failed delivery (D16, §11.2 COD reconciliation): the customer account is flagged and the
 * order's phone becomes a risk signal for later COD orders (see `codRiskForPhone`).
 * Writes `users.cod_risk_flag` on behalf of the customer module (no customer module API yet).
 */
async function flagCodRisk(
  ctx: CommandContext,
  tx: Tx,
  order: { id: string; userId: string | null },
): Promise<void> {
  let userFlagged = false;
  if (order.userId) {
    const updated = await tx
      .update(users)
      .set({ codRiskFlag: true })
      .where(eq(users.id, order.userId))
      .returning({ id: users.id });
    userFlagged = updated.length > 0;
    if (userFlagged) {
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: 'customer.codRiskFlag',
        entityType: 'user',
        entityId: order.userId,
        diff: { codRiskFlag: { from: null, to: true }, orderId: { from: null, to: order.id } },
        ip: ctx.ip,
      });
    }
  }
  await recordOrderEvent(tx, {
    orderId: order.id,
    type: 'cod_risk_flagged',
    actor: staffOrderActor(ctx.actor),
    metadata: { userFlagged },
  });
}

export type OrderCommandResult = {
  orderId: string;
  code: string;
  status: OrderStatus;
  version: number;
};

function outcome(result: TransitionOutcome): CommandResult<OrderCommandResult> {
  return {
    data: {
      orderId: result.orderId,
      code: result.code,
      status: result.to,
      version: result.version,
    },
    tags: result.tags,
  };
}

/** Confirm, start packing, delivered, delivery failed, returned, return requested. */
export async function changeOrderStatus(
  ctx: CommandContext,
  input: OrderTransitionInput,
): Promise<CommandResult<OrderCommandResult>> {
  assertCan(ctx.actor, 'orders.process');
  return ctx.db.transaction(async (tx) =>
    outcome(
      await transitionInTx(ctx, tx, {
        orderId: input.orderId,
        to: input.to,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    ),
  );
}

/** Cancel with a reason. Orders that hold money: Manager/Owner only; the refund queue follows. */
export async function cancelOrder(
  ctx: CommandContext,
  input: CancelOrderInput,
): Promise<CommandResult<OrderCommandResult>> {
  assertCan(ctx.actor, 'orders.process');
  return ctx.db.transaction(async (tx) =>
    outcome(
      await transitionInTx(ctx, tx, {
        orderId: input.orderId,
        to: 'cancelled',
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    ),
  );
}

/**
 * Entering `shipped` requires the carrier + tracking code (§3.5): the shipment row is created
 * in the same transaction. COD shipments carry the balance the carrier must collect.
 */
export async function shipOrder(
  ctx: CommandContext,
  input: ShipOrderInput,
): Promise<CommandResult<OrderCommandResult & { shipmentId: string }>> {
  assertCan(ctx.actor, 'orders.process');
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    const result = await transitionInTx(ctx, tx, {
      orderId: order.id,
      to: 'shipped',
      expectedVersion: input.expectedVersion,
      metadata: { carrier: input.carrier, trackingCode: input.trackingCode },
    });
    const codAmount =
      order.paymentMethod === 'cod' ? Math.max(order.total - order.amountPaid, 0) : 0;
    const shipment = await createShipment(tx, {
      orderId: order.id,
      carrier: input.carrier,
      trackingCode: input.trackingCode,
      codAmount,
      feeActual: input.feeActual,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'shipment.create',
      entityType: 'shipment',
      entityId: shipment.id,
      diff: {
        orderId: { from: null, to: order.id },
        carrier: { from: null, to: input.carrier },
        trackingCode: { from: null, to: input.trackingCode },
        codAmount: { from: null, to: codAmount },
      },
      ip: ctx.ip,
    });
    const base = outcome(result);
    return { data: { ...base.data, shipmentId: shipment.id }, tags: base.tags };
  });
}

/** Internal note on the timeline (`order_events.type = 'note'`); never shown to customers. */
export async function addOrderNote(
  ctx: CommandContext,
  input: OrderNoteInput,
): Promise<CommandResult<{ orderId: string }>> {
  assertCan(ctx.actor, 'orders.process');
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: 'note',
      message: input.message,
      actor: staffOrderActor(ctx.actor),
    });
    // The note text may contain customer details: the audit keeps only its length.
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'order.note',
      entityType: 'order',
      entityId: order.id,
      diff: { noteLength: { from: null, to: input.message.length } },
      ip: ctx.ip,
    });
    const tags = await enqueueRevalidation(ctx.boss, tx, [orderTags.order(order.id)]);
    return { data: { orderId: order.id }, tags };
  });
}

export type BulkConfirmResult = {
  confirmed: string[];
  skipped: { orderId: string; code: string | null; reason: string }[];
};

/**
 * Bulk confirm of COD orders awaiting confirmation (§11.2). One transaction per order, so one
 * refused order (deposit unpaid, already handled) never blocks the others.
 */
export async function bulkConfirmOrders(
  ctx: CommandContext,
  input: BulkOrdersInput,
): Promise<CommandResult<BulkConfirmResult>> {
  assertCan(ctx.actor, 'orders.process');
  const confirmed: string[] = [];
  const skipped: BulkConfirmResult['skipped'] = [];
  const tags = new Set<string>();
  const codes = new Map(
    (
      await ctx.db
        .select({ id: orders.id, code: orders.code })
        .from(orders)
        .where(inArray(orders.id, input.orderIds))
    ).map((row) => [row.id, row.code]),
  );
  for (const orderId of input.orderIds) {
    try {
      const result = await ctx.db.transaction(async (tx) => {
        const order = await lockOrder(tx, orderId);
        if (order.paymentMethod !== 'cod' || order.status !== 'awaiting_confirmation') {
          throw new DomainError('invalid', [{ path: 'status', code: 'notAwaitingCod' }]);
        }
        return transitionInTx(ctx, tx, { orderId, to: 'confirmed' });
      });
      confirmed.push(result.code);
      for (const tag of result.tags) tags.add(tag);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      skipped.push({
        orderId,
        code: codes.get(orderId) ?? null,
        reason: error.fieldErrors[0]?.code ?? error.code,
      });
    }
  }
  return { data: { confirmed, skipped }, tags: [...tags] };
}
