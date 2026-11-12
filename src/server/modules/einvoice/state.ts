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
