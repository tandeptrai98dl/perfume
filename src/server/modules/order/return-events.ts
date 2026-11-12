import { z } from 'zod';

/*
 * Customer returns (ADR-0017) live in the order timeline: no extra table (M3 wave 2). The
 * returns module writes these `order_events` through `recordOrderEvent`; the e-invoice module
 * reads the accepted returns to invoice only what the customer kept. The order module owns
 * `order_events`, so the event names and the metadata contract are declared here.
 *
 * - `return_requested` — customer request, or a request staff opened on the customer's behalf
 *   (message = the customer's description; metadata: request id, reason, preferred resolution,
 *   lines, seal confirmation, who opened it, the status it was opened from, the manager's
 *   window override, private photo keys). A rejected request may be followed by a new one.
 * - `return_approved` — staff accepted the request (message = note to the customer).
 * - `return_rejected` — staff refused it (message = reason, e-mailed); the order goes back to
 *   `delivered`.
 * - `return_received` — the parcel came back: outcome, lines, stock effect, refund queued.
 */
export const RETURN_EVENTS = {
  requested: 'return_requested',
  approved: 'return_approved',
  rejected: 'return_rejected',
  received: 'return_received',
} as const;
export const RETURN_EVENT_TYPES: readonly string[] = Object.values(RETURN_EVENTS);

export const RETURN_REASONS = ['unopened', 'defective', 'wrong_item', 'damaged'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** ADR-0017: defective, wrong or broken items are the shop's fault (shop pays shipping). */
export const FAULT_REASONS: readonly ReturnReason[] = ['defective', 'wrong_item', 'damaged'];

export const RETURN_RESOLUTIONS = ['refund', 'replacement'] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];

export const RETURN_OUTCOMES = ['full', 'partial', 'replacement'] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

const lineSchema = z.object({ orderItemId: z.string(), quantity: z.number().int().positive() });

/** Customer photo of a return, stored privately (`private/returns/…`, staff-only route). */
export const returnPhotoSchema = z.object({
  id: z.string(),
  key: z.string(),
  mime: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
});
export type ReturnPhoto = z.output<typeof returnPhotoSchema>;

export const returnRequestedMetadata = z.object({
  requestId: z.string(),
  reason: z.enum(RETURN_REASONS),
  resolution: z.enum(RETURN_RESOLUTIONS),
  lines: z.array(lineSchema).min(1),
  sealIntact: z.boolean().default(false),
  // ---------- M3 wave 3 ----------
  /** `staff`: opened from the admin order page on the customer's behalf (e.g. by phone). */
  openedBy: z.enum(['customer', 'staff']).default('customer'),
  /** Status the order left (`completed` only with the manager's window override). */
  openedFrom: z.enum(['delivered', 'completed']).default('delivered'),
  /** A manager opened it after the return window (reason audited). */
  windowOverride: z.object({ reason: z.string() }).nullable().default(null),
  photos: z.array(returnPhotoSchema).max(3).default([]),
});
export type ReturnRequestedMetadata = z.output<typeof returnRequestedMetadata>;

export const returnRefundBreakdown = z.object({
  merchandise: z.number().int().nonnegative(),
  shipping: z.number().int().nonnegative(),
  giftWrap: z.number().int().nonnegative(),
  returnShipping: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ReturnRefundBreakdown = z.output<typeof returnRefundBreakdown>;

export const returnReceivedMetadata = z.object({
  requestId: z.string(),
  outcome: z.enum(RETURN_OUTCOMES),
  lines: z.array(
    lineSchema.extend({
      variantId: z.string(),
      /** Merchandise refunded for this line (after its share of the coupon). */
      amount: z.number().int().nonnegative(),
    }),
  ),
  /** The original shipping and gift-wrap fees were refunded (full return, shop's fault). */
  feesRefunded: z.boolean(),
  /** Returned units went back to sellable stock (otherwise written off as `damage`). */
  restocked: z.boolean(),
  refund: returnRefundBreakdown.extend({
    /** Refund queued now (≤ money held); null when nothing was queued. */
    refundId: z.string().nullable(),
    queued: z.number().int().nonnegative(),
    /** Owed once the money arrives (COD remittance): queued automatically then. */
    deferred: z.number().int().nonnegative().default(0),
    /** Return shipping paid out manually beyond the order's money (bank transfer / cash). */
    payout: z.number().int().nonnegative().default(0),
    payoutRefundId: z.string().nullable().default(null),
    /** Owed but neither held, expected nor payable as return shipping: staff were alerted. */
    shortfall: z.number().int().nonnegative(),
  }),
});
export type ReturnReceivedMetadata = z.output<typeof returnReceivedMetadata>;
export type ReturnRequestedMetadataInput = z.input<typeof returnRequestedMetadata>;

export function parseReturnRequested(metadata: unknown): ReturnRequestedMetadata | null {
  const parsed = returnRequestedMetadata.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

export function parseReturnReceived(metadata: unknown): ReturnReceivedMetadata | null {
  const parsed = returnReceivedMetadata.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
