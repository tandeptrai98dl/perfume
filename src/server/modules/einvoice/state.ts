/*
 * E-invoice state of an order, derived from the order row (`einvoice_ref`) and its timeline
 * events (no extra table, ADR-0013): every attempt, final failure, manual retry and success is
 * an `order_events` row written by the einvoice module through the order module's public API.
 */

export const EINVOICE_EVENTS = {
  issued: 'einvoice_issued',
  attemptFailed: 'einvoice_attempt_failed',
  failed: 'einvoice_failed',
  retryRequested: 'einvoice_retry_requested',
} as const;
export const EINVOICE_EVENT_TYPES: readonly string[] = Object.values(EINVOICE_EVENTS);

/** Total tries per job run (first try + pg-boss retries, see JOBS['einvoice.issue']). */
export const EINVOICE_MAX_ATTEMPTS = 6;

/** Order statuses that get an invoice: delivered, and later steps of a delivered order. */
export const EINVOICE_ELIGIBLE_STATUSES: readonly string[] = [
  'delivered',
  'completed',
  'return_requested',
];

export type EinvoiceState = 'not_applicable' | 'pending' | 'retrying' | 'issued' | 'failed';

export type EinvoiceEventRow = {
  type: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type EinvoiceStatusSummary = {
  state: EinvoiceState;
  /** Failed tries since the last manual retry. */
  attempts: number;
  reason: string | null;
  lastEventAt: Date | null;
  canRetry: boolean;
};

/** Failed tries since the latest manual retry request (events in chronological order). */
export function attemptsSinceRetry(events: readonly EinvoiceEventRow[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === EINVOICE_EVENTS.retryRequested) count = 0;
    else if (
      event.type === EINVOICE_EVENTS.attemptFailed ||
      event.type === EINVOICE_EVENTS.failed
    ) {
      count += 1;
    }
  }
  return count;
}

export function einvoiceStatus(
  order: { status: string; deliveredAt: Date | null; einvoiceRef: string | null },
  events: readonly EinvoiceEventRow[],
): EinvoiceStatusSummary {
  const relevant = events.filter((e) => EINVOICE_EVENT_TYPES.includes(e.type));
  const last = relevant.at(-1) ?? null;
  const attempts = attemptsSinceRetry(relevant);
  const reason = typeof last?.metadata?.reason === 'string' ? last.metadata.reason : null;
  const eligible = EINVOICE_ELIGIBLE_STATUSES.includes(order.status);
  const base = { attempts, lastEventAt: last?.createdAt ?? null };

  if (order.einvoiceRef) return { ...base, state: 'issued', reason: null, canRetry: false };
  if (!order.deliveredAt && !last) {
    return { ...base, state: 'not_applicable', reason: null, canRetry: false };
  }
  if (last?.type === EINVOICE_EVENTS.failed) {
    return { ...base, state: 'failed', reason, canRetry: eligible };
  }
  if (last?.type === EINVOICE_EVENTS.attemptFailed) {
    return { ...base, state: 'retrying', reason, canRetry: false };
  }
  // Delivered, job queued or not created (e.g. delivered before e-invoicing existed): a retry
  // is harmless (idempotent), so staff may start one.
  return {
    ...base,
    state: eligible ? 'pending' : 'not_applicable',
    reason: null,
    canRetry: eligible,
  };
}

// ---------- Cancellation and replacement (M3 wave 2 returns stream) ----------
/*
 * After an invoice is issued it can be cancelled (everything was returned) or replaced (part
 * of it was returned, or staff correct it), always through the provider adapter from the
 * `einvoice.adjust` outbox job. Each request, failed try and result is an `order_events` row;
 * `orders.einvoice_ref` keeps the current invoice (a replacement swaps it, a cancellation keeps
 * the cancelled number for the record). Kept apart from the issuing events above so issuing,
 * retries and the failed list are unchanged.
 */
export const EINVOICE_ADJUSTMENT_EVENTS = {
  requested: 'einvoice_adjust_requested',
  attemptFailed: 'einvoice_adjust_attempt_failed',
  failed: 'einvoice_adjust_failed',
  cancelled: 'einvoice_cancelled',
  replaced: 'einvoice_replaced',
} as const;
export const EINVOICE_ADJUSTMENT_EVENT_TYPES: readonly string[] = Object.values(
  EINVOICE_ADJUSTMENT_EVENTS,
);

export const EINVOICE_ADJUSTMENT_ACTIONS = ['cancel', 'replace'] as const;
export type EinvoiceAdjustmentAction = (typeof EINVOICE_ADJUSTMENT_ACTIONS)[number];

export type EinvoiceAdjustmentState =
  'none' | 'pending' | 'retrying' | 'failed' | 'cancelled' | 'replaced';

export type EinvoiceAdjustmentEventRow = EinvoiceEventRow & { message: string | null };

export type EinvoiceAdjustmentSummary = {
  state: EinvoiceAdjustmentState;
  action: EinvoiceAdjustmentAction | null;
  adjustmentId: string | null;
  /** Why staff (or the return) asked for it. */
  requestReason: string | null;
  /** Provider failure code of the latest failed try. */
  reason: string | null;
  attempts: number;
  lastEventAt: Date | null;
  /** An invoice exists, is not cancelled and no adjustment is running. */
  canAdjust: boolean;
};

function metaString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value ? value : null;
}

/** State of the latest cancellation/replacement request (events in chronological order). */
export function einvoiceAdjustmentStatus(
  order: { einvoiceRef: string | null },
  events: readonly EinvoiceAdjustmentEventRow[],
): EinvoiceAdjustmentSummary {
  let summary: EinvoiceAdjustmentSummary = {
    state: 'none',
    action: null,
    adjustmentId: null,
    requestReason: null,
    reason: null,
    attempts: 0,
    lastEventAt: null,
    canAdjust: false,
  };
  let cancelled = false;
  for (const event of events) {
    const adjustmentId = metaString(event.metadata, 'adjustmentId');
    if (event.type === EINVOICE_ADJUSTMENT_EVENTS.cancelled) cancelled = true;
    if (event.type === EINVOICE_ADJUSTMENT_EVENTS.requested) {
      const action = metaString(event.metadata, 'action');
      summary = {
        ...summary,
        state: 'pending',
        action: action === 'cancel' || action === 'replace' ? action : null,
        adjustmentId,
        requestReason: event.message,
        reason: null,
        attempts: 0,
        lastEventAt: event.createdAt,
      };
      continue;
    }
    if (!adjustmentId || adjustmentId !== summary.adjustmentId) {
      // A result of an older request (e.g. a cancellation that overtook a replacement).
      if (event.type === EINVOICE_ADJUSTMENT_EVENTS.cancelled) {
        summary = { ...summary, state: 'cancelled', lastEventAt: event.createdAt };
      }
      continue;
    }
    switch (event.type) {
      case EINVOICE_ADJUSTMENT_EVENTS.attemptFailed:
        summary = {
          ...summary,
          state: 'retrying',
          attempts: summary.attempts + 1,
          reason: metaString(event.metadata, 'reason'),
          lastEventAt: event.createdAt,
        };
        break;
      case EINVOICE_ADJUSTMENT_EVENTS.failed:
        summary = {
          ...summary,
          state: 'failed',
          attempts: summary.attempts + 1,
          reason: metaString(event.metadata, 'reason'),
          lastEventAt: event.createdAt,
        };
        break;
      case EINVOICE_ADJUSTMENT_EVENTS.cancelled:
        summary = { ...summary, state: 'cancelled', lastEventAt: event.createdAt };
        break;
      case EINVOICE_ADJUSTMENT_EVENTS.replaced:
        summary = { ...summary, state: 'replaced', lastEventAt: event.createdAt };
        break;
    }
  }
  // A cancelled invoice is final: later requests are refused (and skipped by the job).
  if (cancelled) summary = { ...summary, state: 'cancelled' };
  const running = summary.state === 'pending' || summary.state === 'retrying';
  return {
    ...summary,
    canAdjust: !!order.einvoiceRef && !cancelled && !running,
  };
}
