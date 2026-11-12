import type { FieldIssue } from '@/server/lib/command-context';
import {
  FAULT_REASONS,
  type ReturnPhoto,
  parseReturnReceived,
  parseReturnRequested,
  RETURN_EVENTS,
  type ReturnOutcome,
  type ReturnReason,
  type ReturnRefundBreakdown,
  type ReturnResolution,
} from '@/server/modules/order';

/*
 * Customer return rules (ADR-0017), pure and unit-tested:
 * - a return can be requested only for a `delivered` order, within the return window
 *   (`returns.windowDays` setting, default 7 days) counted from the real delivery time;
 * - at most one open request per order at a time: after a rejection a new request may be filed
 *   (within the window); once goods were received the order's return is over;
 * - staff may open a request on the customer's behalf (same rules); a manager may override the
 *   window — also for an order already `completed` — with an audited reason (ADR-0027);
 * - the customer chooses lines and quantities (≤ bought), a reason and, for the shop's fault
 *   (defective / wrong / damaged), refund or replacement; unopened change of mind is refund only
 *   and needs the seal confirmation;
 * - refund: the returned lines' paid amount (after their share of the coupon); for the shop's
 *   fault also the return shipping the customer paid and, when everything comes back, the
 *   original shipping and gift-wrap fees (100 % refund); a replacement refunds nothing.
 */

export const DAY_MS = 86_400_000;
export const RETURN_DESCRIPTION_MAX = 1000;
export const RETURN_DESCRIPTION_MIN_FAULT = 10;

export function isFaultReason(reason: ReturnReason): boolean {
  return FAULT_REASONS.includes(reason);
}

export function resolutionsFor(reason: ReturnReason): ReturnResolution[] {
  return isFaultReason(reason) ? ['refund', 'replacement'] : ['refund'];
}

export function returnDeadline(deliveredAt: Date, windowDays: number): Date {
  return new Date(deliveredAt.getTime() + windowDays * DAY_MS);
}

export type ReturnIneligibility = 'notDelivered' | 'windowExpired' | 'alreadyRequested';

export type ReturnEligibility =
  | { eligible: true; deadline: Date; windowOverride: boolean }
  | { eligible: false; reason: ReturnIneligibility; deadline: Date | null };

/** A request blocks a new one unless it was rejected. */
export function blocksNewRequest(status: ReturnStatus | null | undefined): boolean {
  return !!status && status !== 'rejected';
}

export function returnEligibility(input: {
  status: string;
  deliveredAt: Date | null;
  windowDays: number;
  now: Date;
  /** Status of the order's latest request, if any. */
  latest: ReturnStatus | null;
  /** A manager lifts the window (staff-opened returns only, audited by the caller). */
  overrideWindow?: boolean;
}): ReturnEligibility {
  const deadline = input.deliveredAt ? returnDeadline(input.deliveredAt, input.windowDays) : null;
  if (blocksNewRequest(input.latest)) {
    return { eligible: false, reason: 'alreadyRequested', deadline };
  }
  if (!deadline) return { eligible: false, reason: 'notDelivered', deadline };
  const expired = input.status === 'completed' || input.now.getTime() > deadline.getTime();
  // `completed` = the window passed (orders.complete-delivered).
  if (input.status !== 'delivered' && input.status !== 'completed') {
    return { eligible: false, reason: 'notDelivered', deadline };
  }
  if (expired && !input.overrideWindow) {
    return { eligible: false, reason: 'windowExpired', deadline };
  }
  return { eligible: true, deadline, windowOverride: expired };
}

export type ReturnOrderLine = {
  id: string;
  variantId: string;
  quantity: number;
  lineTotal: number;
};

export type ReturnLineInput = { orderItemId: string; quantity: number };

/** Field issues (translation codes) for the chosen lines; empty when valid. */
export function validateReturnLines(
  items: readonly Pick<ReturnOrderLine, 'id' | 'quantity'>[],
  lines: readonly ReturnLineInput[],
): FieldIssue[] {
  if (lines.length === 0) return [{ path: 'lines', code: 'noLines' }];
  const issues: FieldIssue[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const item = items.find((candidate) => candidate.id === line.orderItemId);
    if (seen.has(line.orderItemId)) issues.push({ path: `lines.${index}`, code: 'duplicateLine' });
    seen.add(line.orderItemId);
    if (!item) issues.push({ path: `lines.${index}`, code: 'unknownLine' });
    else if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      issues.push({ path: `lines.${index}.quantity`, code: 'tooSmall' });
    } else if (line.quantity > item.quantity) {
      issues.push({ path: `lines.${index}.quantity`, code: 'quantityTooLarge' });
    }
  });
  return issues;
}

/** Every line comes back in full. */
export function isFullReturn(
  items: readonly Pick<ReturnOrderLine, 'id' | 'quantity'>[],
  lines: readonly ReturnLineInput[],
): boolean {
  return items.every(
    (item) => lines.find((line) => line.orderItemId === item.id)?.quantity === item.quantity,
  );
}

/** Paid amount of `quantity` units of a line (its coupon share included), whole đồng. */
export function lineRefundAmount(
  item: Pick<ReturnOrderLine, 'quantity' | 'lineTotal'>,
  quantity: number,
): number {
  if (quantity >= item.quantity) return item.lineTotal;
  return Math.floor((item.lineTotal * quantity) / item.quantity);
}

export type ReturnRefundInput = {
  items: readonly ReturnOrderLine[];
  lines: readonly ReturnLineInput[];
  reason: ReturnReason;
  resolution: ReturnResolution;
  shippingFee: number;
  giftWrapFee: number;
  /** Return shipping the customer paid (reimbursed for the shop's fault only). */
  returnShippingFee?: number;
};

export type ReturnRefundPlan = ReturnRefundBreakdown & {
  outcome: ReturnOutcome;
  feesRefunded: boolean;
  lines: Array<ReturnLineInput & { variantId: string; amount: number }>;
};

export function planReturnRefund(input: ReturnRefundInput): ReturnRefundPlan {
  const full = isFullReturn(input.items, input.lines);
  const lines = input.lines.map((line) => {
    const item = input.items.find((candidate) => candidate.id === line.orderItemId);
    if (!item) throw new RangeError(`Unknown order line ${line.orderItemId}`);
    return { ...line, variantId: item.variantId, amount: lineRefundAmount(item, line.quantity) };
  });
  if (input.resolution === 'replacement') {
    return {
      outcome: 'replacement',
      feesRefunded: false,
      lines: lines.map((line) => ({ ...line, amount: 0 })),
      merchandise: 0,
      shipping: 0,
      giftWrap: 0,
      returnShipping: 0,
      total: 0,
    };
  }
  const fault = isFaultReason(input.reason);
  const feesRefunded = fault && full;
  const merchandise = lines.reduce((sum, line) => sum + line.amount, 0);
  const shipping = feesRefunded ? input.shippingFee : 0;
  const giftWrap = feesRefunded ? input.giftWrapFee : 0;
  const returnShipping = fault ? Math.max(0, input.returnShippingFee ?? 0) : 0;
  return {
    outcome: full ? 'full' : 'partial',
    feesRefunded,
    lines,
    merchandise,
    shipping,
    giftWrap,
    returnShipping,
    total: merchandise + shipping + giftWrap + returnShipping,
  };
}

// ---------- Request state from the order timeline ----------

export type ReturnEventRow = {
  id: string;
  type: string;
  message: string | null;
  metadata: unknown;
  createdAt: Date;
};

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received';

export type ReturnState = {
  requestId: string;
  status: ReturnStatus;
  reason: ReturnReason;
  resolution: ReturnResolution;
  lines: ReturnLineInput[];
  sealIntact: boolean;
  description: string | null;
  openedBy: 'customer' | 'staff';
  openedFrom: 'delivered' | 'completed';
  windowOverride: { reason: string } | null;
  photos: ReturnPhoto[];
  requestedAt: Date;
  approvedAt: Date | null;
  approvalNote: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  receivedAt: Date | null;
  outcome: ReturnOutcome | null;
  restocked: boolean | null;
  refund:
    | (ReturnRefundBreakdown & {
        queued: number;
        deferred: number;
        payout: number;
        shortfall: number;
      })
    | null;
};

function requestIdOf(metadata: unknown): string | null {
  const value = (metadata as { requestId?: unknown } | null)?.requestId;
  return typeof value === 'string' ? value : null;
}

/**
 * The latest return request of an order and what happened to it, from its timeline events
 * (oldest first). A request filed after a rejection replaces it. Null when nobody ever asked
 * for a return.
 */
export function foldReturnEvents(events: readonly ReturnEventRow[]): ReturnState | null {
  let state: ReturnState | null = null;
  for (const event of events) {
    if (event.type === RETURN_EVENTS.requested) {
      const meta = parseReturnRequested(event.metadata);
      if (!meta) continue;
      state = {
        requestId: meta.requestId,
        status: 'requested',
        reason: meta.reason,
        resolution: meta.resolution,
        lines: meta.lines,
        sealIntact: meta.sealIntact,
        description: event.message,
        openedBy: meta.openedBy,
        openedFrom: meta.openedFrom,
        windowOverride: meta.windowOverride,
        photos: meta.photos,
        requestedAt: event.createdAt,
        approvedAt: null,
        approvalNote: null,
        rejectedAt: null,
        rejectionReason: null,
        receivedAt: null,
        outcome: null,
        restocked: null,
        refund: null,
      };
      continue;
    }
    if (!state || requestIdOf(event.metadata) !== state.requestId) continue;
    if (event.type === RETURN_EVENTS.approved && state.status === 'requested') {
      state = {
        ...state,
        status: 'approved',
        approvedAt: event.createdAt,
        approvalNote: event.message,
      };
    } else if (
      event.type === RETURN_EVENTS.rejected &&
      (state.status === 'requested' || state.status === 'approved')
    ) {
      state = {
        ...state,
        status: 'rejected',
        rejectedAt: event.createdAt,
        rejectionReason: event.message,
      };
    } else if (event.type === RETURN_EVENTS.received && state.status === 'approved') {
      const meta = parseReturnReceived(event.metadata);
      if (!meta) continue;
      const {
        merchandise,
        shipping,
        giftWrap,
        returnShipping,
        total,
        queued,
        deferred,
        payout,
        shortfall,
      } = meta.refund;
      state = {
        ...state,
        status: 'received',
        receivedAt: event.createdAt,
        outcome: meta.outcome,
        restocked: meta.restocked,
        refund: {
          merchandise,
          shipping,
          giftWrap,
          returnShipping,
          total,
          queued,
          deferred,
          payout,
          shortfall,
        },
      };
    }
  }
  return state;
}

/** Default for the "back to sellable stock" switch: only sealed, unopened returns. */
export function defaultResellable(reason: ReturnReason): boolean {
  return reason === 'unopened';
}
