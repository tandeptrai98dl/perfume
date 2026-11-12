import type { QueueOptions } from 'pg-boss';
import { z } from 'zod';

/**
 * Every background job: queue name, payload schema and retry policy.
 * Payloads are validated when enqueued and again when handled (the DB is not a trust boundary
 * we want to rely on across deploys).
 */

const retryPolicy = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 300,
} satisfies QueueOptions;

export const JOBS = {
  'system.test-email': {
    schema: z.object({ to: z.email(), locale: z.enum(['vi', 'en']) }),
    queue: retryPolicy,
  },
  'cache.revalidate': {
    schema: z.object({
      tags: z.array(z.string().min(1).max(256)).min(1).max(100),
      expire: z.enum(['max', 'now']).default('max'),
    }),
    queue: { ...retryPolicy, retryDelay: 5 },
  },

  // ---------- M2: orders, payments, notifications ----------
  /** Customer confirmation email + staff "new order" alert (order locale, §10.5). */
  'order.placed': {
    schema: z.object({ orderId: z.uuid() }),
    queue: retryPolicy,
  },
  /** Every status change: customer email for shipped/delivered/cancelled, staff alerts. */
  'order.status-changed': {
    schema: z.object({ orderId: z.uuid(), from: z.string(), to: z.string() }),
    queue: retryPolicy,
  },
  /**
   * Staff edited the order before shipment (§3.4 step 8): customer "order updated" email with
   * the new items/totals and, when money is due, the link to pay the difference. `version` is
   * the order version written by the edit (one e-mail per edit).
   */
  'order.updated': {
    schema: z.object({ orderId: z.uuid(), version: z.number().int().nonnegative() }),
    queue: retryPolicy,
  },
  /** A payment succeeded (full, deposit, balance): customer "payment received" email. */
  'payment.received': {
    schema: z.object({ orderId: z.uuid(), paymentId: z.uuid() }),
    queue: retryPolicy,
  },
  /** Internal alert by email + Telegram (ADR-0019). Never put PII in `message`. */
  'staff.alert': {
    schema: z.object({
      kind: z.enum([
        'new_order',
        'high_value_cod',
        'suspicious_ipn',
        'late_payment_refund',
        'low_stock',
        'job_failed',
        // M3: e-invoice failed for good; staff edit queued a refund.
        'einvoice_failed',
        'edit_refund',
        // M3 wave 2 (customers & alerts stream): reviews awaiting moderation (throttled).
        'review_pending',
        // M3 wave 2 returns: a customer asked for a return; an invoice cancel/replace failed.
        'return_requested',
        'einvoice_adjustment_failed',
      ]),
      orderId: z.uuid().optional(),
      message: z.string().max(500).optional(),
      // ---------- M3 wave 2 (customers & alerts stream) ----------
      /** `low_stock`: the variant that crossed its threshold (details read at send time). */
      variantId: z.uuid().optional(),
      /** `job_failed`: the dead-lettered job (queue name + id only, never its payload). */
      job: z
        .object({
          name: z.string().min(1).max(100),
          id: z.uuid(),
          attempts: z.number().int().nonnegative(),
        })
        .optional(),
    }),
    queue: retryPolicy,
  },
  /**
   * Account emails (verification, password reset) in the user's locale. `staff_invite` (M3
   * admin stream): set-password link for an invited staff member (admin is Vietnamese only).
   */
  'auth.email': {
    schema: z.object({
      to: z.email(),
      locale: z.enum(['vi', 'en']),
      kind: z.enum(['verify_email', 'reset_password', 'staff_invite']),
      url: z.url(),
    }),
    queue: retryPolicy,
  },
  /** Cron: cancel online orders whose reservation expired unpaid; expire stale payment sessions. */
  'orders.expire-unpaid': {
    schema: z.object({}).default({}),
    queue: { ...retryPolicy, retryLimit: 1, expireInSeconds: 120 },
  },
  /** Cron: cancel COD orders not confirmed by staff within the window (24 h, ADR-0006). */
  'orders.cancel-unconfirmed-cod': {
    schema: z.object({}).default({}),
    queue: { ...retryPolicy, retryLimit: 1, expireInSeconds: 120 },
  },
  /** Cron: delivered → completed once the return window has passed (§3.5). */
  'orders.complete-delivered': {
    schema: z.object({}).default({}),
    queue: { ...retryPolicy, retryLimit: 1, expireInSeconds: 300 },
  },

  // ---------- M3: e-invoicing (D13) and manual-order payment links ----------
  /**
   * Issue the e-invoice of a delivered order (enqueued by `transitionOrder`, or by a staff
   * retry). The handler counts its own attempts (timeline events) and stops after
   * EINVOICE_MAX_ATTEMPTS = retryLimit + 1 with a `staff.alert`; backoff 2, 4, 8, 16, 32 min.
   */
  'einvoice.issue': {
    schema: z.object({ orderId: z.uuid() }),
    queue: { retryLimit: 5, retryDelay: 120, retryBackoff: true, expireInSeconds: 180 },
  },
  /** Manual order paid online: e-mail the payment page link to the customer (order locale). */
  'order.payment-link': {
    schema: z.object({ orderId: z.uuid() }),
    queue: retryPolicy,
  },

  // ---------- M3: reviews (ADR-0008) ----------
  /**
   * Review invitation a few days after delivery: guest one-time links per line (hashed
   * tokens, 30 days) or, for members, a link to the account's "Reviews to write".
   */
  'review.invite': {
    schema: z.object({ orderId: z.uuid() }),
    queue: retryPolicy,
  },

  // ---------- M3 hardening ----------
  /** Cron: delete expired `rate_limits` counters (shared limiter, §12). */
  'system.prune-rate-limits': {
    schema: z.object({}).default({}),
    queue: { ...retryPolicy, retryLimit: 1, expireInSeconds: 120 },
  },

  // ---------- M3 privacy: data-subject requests (PDPL 91/2025, Decree 356/2025) ----------
  /** Guest request: e-mail with the signed confirmation link (request created on confirm). */
  'privacy.verify-request': {
    schema: z.object({
      to: z.email(),
      locale: z.enum(['vi', 'en']),
      type: z.enum(['export', 'delete', 'correct', 'withdraw_consent']),
      url: z.url(),
    }),
    queue: retryPolicy,
  },
  /** Customer e-mail about a request: received (with due date), completed or rejected. */
  'privacy.notify': {
    schema: z.object({
      requestId: z.uuid(),
      kind: z.enum(['received', 'completed', 'rejected']),
    }),
    queue: retryPolicy,
  },
  /** Completes an export request and e-mails the download link (valid 7 days). */
  'privacy.export': {
    schema: z.object({ requestId: z.uuid() }),
    queue: retryPolicy,
  },

  // ---------- M3 wave 2: newsletter double opt-in (§2 Marketing) ----------
  /** Sign-up: e-mail with the signed confirmation link (nothing stored before the click). */
  'newsletter.confirm-request': {
    schema: z.object({ to: z.email(), locale: z.enum(['vi', 'en']), url: z.url() }),
    queue: retryPolicy,
  },
  /** Confirmed: welcome e-mail with the signed unsubscribe link (+ RFC 8058 headers). */
  'newsletter.welcome': {
    schema: z.object({ subscriberId: z.uuid() }),
    queue: retryPolicy,
  },

  // ---------- M3 wave 2: customer returns (ADR-0017) and e-invoice adjustments ----------
  /**
   * Customer e-mail about a return request, in the order's locale: received, approved (with
   * the staff note), rejected (with the reason), goods received (refund or replacement).
   * `eventId` is the request id, so each step is sent once per request.
   */
  'return.notify': {
    schema: z.object({
      orderId: z.uuid(),
      requestId: z.uuid(),
      kind: z.enum(['requested', 'approved', 'rejected', 'received']),
    }),
    queue: retryPolicy,
  },
  /**
   * Cancel or replace the order's issued e-invoice through the provider (returns, staff
   * corrections). Same attempt counting and backoff as `einvoice.issue`.
   */
  'einvoice.adjust': {
    schema: z.object({ orderId: z.uuid(), adjustmentId: z.uuid() }),
    queue: { retryLimit: 5, retryDelay: 120, retryBackoff: true, expireInSeconds: 180 },
  },
} as const;

/** Recurring jobs scheduled by the worker (pg-boss cron, UTC). */
export const CRON_JOBS: Partial<Record<keyof typeof JOBS, string>> = {
  'orders.expire-unpaid': '* * * * *',
  'orders.cancel-unconfirmed-cod': '*/5 * * * *',
  'orders.complete-delivered': '17 * * * *',
  'system.prune-rate-limits': '41 * * * *',
};

export type JobName = keyof typeof JOBS;
export type JobInput<N extends JobName> = z.input<(typeof JOBS)[N]['schema']>;
export type JobPayload<N extends JobName> = z.output<(typeof JOBS)[N]['schema']>;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** Dead-letter queue shared by all jobs: payloads that exhausted their retries. */
export const DEAD_LETTER_QUEUE = 'system.dead-letter';
