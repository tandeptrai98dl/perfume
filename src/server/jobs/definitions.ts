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
      ]),
      orderId: z.uuid().optional(),
      message: z.string().max(500).optional(),
    }),
    queue: retryPolicy,
  },
  /** Account emails (verification, password reset) in the user's locale. */
  'auth.email': {
    schema: z.object({
      to: z.email(),
      locale: z.enum(['vi', 'en']),
      kind: z.enum(['verify_email', 'reset_password']),
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
} as const;

/** Recurring jobs scheduled by the worker (pg-boss cron, UTC). */
export const CRON_JOBS: Partial<Record<keyof typeof JOBS, string>> = {
  'orders.expire-unpaid': '* * * * *',
  'orders.cancel-unconfirmed-cod': '*/5 * * * *',
  'orders.complete-delivered': '17 * * * *',
};

export type JobName = keyof typeof JOBS;
export type JobInput<N extends JobName> = z.input<(typeof JOBS)[N]['schema']>;
export type JobPayload<N extends JobName> = z.output<(typeof JOBS)[N]['schema']>;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** Dead-letter queue shared by all jobs: payloads that exhausted their retries. */
export const DEAD_LETTER_QUEUE = 'system.dead-letter';
