import { eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { orderEvents, orders } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import { DomainError, type Tx } from '@/server/lib/command-context';
import { commitReservations, releaseReservations, restockOrder } from '@/server/modules/inventory';

import {
  canTransition,
  DEDUCTED_STATUSES,
  RESERVING_STATUSES,
  type OrderStatus,
  type TransitionActor,
} from './state-machine';

/*
 * The only way to change `orders.status` (CLAUDE.md, ADR-0005). Runs inside the caller's
 * transaction: locks the order row, checks the state machine and the optimistic version, applies
 * stock effects, writes an `order_events` row and enqueues `order.status-changed` (outbox).
 */

export type OrderActor = {
  type: 'system' | 'customer' | 'staff';
  /** User id for customers/staff; null for the system. */
  id: string | null;
  /** Staff with `orders.cancelPaid` act as `manager` (Owner/Manager, RBAC §11.1). */
  isManager?: boolean;
};

export type TransitionInput = {
  orderId: string;
  to: OrderStatus;
  actor: OrderActor;
  reason?: string;
  /** Staff edits pass the version they loaded; a mismatch is a `conflict`. */
  expectedVersion?: number;
  metadata?: Record<string, unknown>;
};

export type TransitionResult = {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  version: number;
};

function machineActor(actor: OrderActor): TransitionActor {
  if (actor.type === 'staff') return actor.isManager ? 'manager' : 'staff';
  return actor.type;
}

const TIMESTAMP_COLUMN: Partial<
  Record<OrderStatus, 'confirmedAt' | 'shippedAt' | 'deliveredAt' | 'completedAt' | 'cancelledAt'>
> = {
  confirmed: 'confirmedAt',
  shipped: 'shippedAt',
  delivered: 'deliveredAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

/** Locks and returns the order row (`SELECT … FOR UPDATE`). */
export async function lockOrder(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw new DomainError('notFound');
  return order;
}

export async function transitionOrder(
  tx: Tx,
  boss: PgBoss,
  input: TransitionInput,
): Promise<TransitionResult> {
  const order = await lockOrder(tx, input.orderId);
  const from = order.status as OrderStatus;
  if (input.expectedVersion !== undefined && input.expectedVersion !== order.version) {
    throw new DomainError('conflict');
  }
  if (!canTransition(from, input.to, machineActor(input.actor))) {
    throw new DomainError('invalid', [{ path: 'status', code: `transition:${from}->${input.to}` }]);
  }

  // Stock effects (ADR-0006).
  if (input.to === 'confirmed' && RESERVING_STATUSES.includes(from)) {
    await commitReservations(tx, order.id, input.actor.id);
  } else if (input.to === 'cancelled' && RESERVING_STATUSES.includes(from)) {
    await releaseReservations(tx, order.id);
  } else if (input.to === 'cancelled' && DEDUCTED_STATUSES.includes(from)) {
    await restockOrder(tx, {
      orderId: order.id,
      reason: 'release',
      actorId: input.actor.id,
      note: 'order cancelled',
    });
  } else if (input.to === 'returned') {
    await restockOrder(tx, {
      orderId: order.id,
      reason: 'return',
      actorId: input.actor.id,
      note: 'parcel returned',
    });
  }

  // A rejected or partly accepted return goes back to `delivered` (or `completed` for a
  // reopened order, ADR-0027): keep the real delivery/completion time, so the return window
  // (and `orders.complete-delivered`) still counts from it (ADR-0017).
  const kept =
    from === 'return_requested' &&
    ((input.to === 'delivered' && order.deliveredAt) ||
      (input.to === 'completed' && order.completedAt));
  const column = kept ? undefined : TIMESTAMP_COLUMN[input.to];
  const [updated] = await tx
    .update(orders)
    .set({
      status: input.to,
      version: sql`${orders.version} + 1`,
      ...(column ? { [column]: new Date() } : {}),
      ...(input.to === 'cancelled' ? { cancelReason: input.reason ?? null } : {}),
    })
    .where(eq(orders.id, order.id))
    .returning({ version: orders.version });

  await recordOrderEvent(tx, {
    orderId: order.id,
    type: 'status_changed',
    fromStatus: from,
    toStatus: input.to,
    message: input.reason,
    actor: input.actor,
    metadata: input.metadata,
  });
  await enqueue(boss, tx, 'order.status-changed', { orderId: order.id, from, to: input.to });
  // D13: the real delivery issues the e-invoice (outbox, same transaction). A rejected return
  // (`return_requested → delivered`) does not; the job itself is idempotent anyway.
  if (input.to === 'delivered' && from === 'shipped' && !order.einvoiceRef) {
    await enqueue(boss, tx, 'einvoice.issue', { orderId: order.id });
  }

  return { orderId: order.id, from, to: input.to, version: updated!.version };
}

/** Appends to the order timeline (status changes, payments, edits, notes). Never put secrets here. */
export async function recordOrderEvent(
  tx: Pick<Tx, 'insert'>,
  input: {
    orderId: string;
    type: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    message?: string | null;
    diff?: unknown;
    actor: OrderActor;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.insert(orderEvents).values({
    orderId: input.orderId,
    type: input.type,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    message: input.message ?? null,
    diff: input.diff ?? null,
    actorType: input.actor.type,
    actorId: input.actor.id,
    metadata: input.metadata ?? null,
  });
}
