/*
 * Constants of the admin customer screens, in a file without imports: Zod schemas use them at
 * module evaluation, and the customer and order modules import each other.
 */

/** Registered accounts and guest contacts (guest orders grouped by phone). */
export const CUSTOMER_TYPES = ['registered', 'guest'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_SORTS = ['lastOrder', 'spend', 'orders', 'name', 'since'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** Rows of one CSV export (bulk egress cap, like the audit export). */
export const CUSTOMER_EXPORT_LIMIT = 5000;
export const CUSTOMER_NOTE_MAX = 1000;
export const COD_RISK_REASON_MIN = 5;
export const COD_RISK_REASON_MAX = 500;

/**
 * Orders that do not count towards lifetime spend: never paid/confirmed, undone, or a COD
 * parcel the customer refused (the dashboard's NON_REVENUE_STATUSES + `delivery_failed`).
 * Spend of the other orders is `total − amount_refunded` (integer VND).
 */
export const NON_SPEND_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'cancelled',
  'returned',
  'delivery_failed',
] as const;

/** Audit actions that make up a customer's notes and risk history (no extra table, §6.2). */
export const CUSTOMER_NOTE_ACTION = 'customer.note';
export const COD_RISK_ACTION = 'customer.codRiskFlag';
