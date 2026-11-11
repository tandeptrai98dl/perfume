import { z } from 'zod';

import { ORDER_STATUSES, type OrderStatus } from './state-machine';

/*
 * Admin (staff) inputs for orders (§11.2 Orders). Error messages are translation codes
 * (`admin.errors.<code>`). Manual orders and order edits (wave 2) will add their schemas here.
 */

export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'cod',
  'vnpay',
  'payos',
  'bank_transfer',
  'momo',
  'zalopay',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARRIERS = ['ghn', 'ghtk', 'viettel_post', 'self', 'other'] as const;
export type Carrier = (typeof CARRIERS)[number];

/**
 * Work queues shown as tabs with counts (§11.2 dashboard "awaiting confirmation, to pack,
 * in transit"). `toPack` covers confirmed orders and those already being packed.
 */
export const ORDER_TABS = {
  awaiting: ['awaiting_confirmation'],
  toPack: ['confirmed', 'processing'],
  inTransit: ['shipped'],
} as const satisfies Record<string, readonly OrderStatus[]>;
export type OrderTab = keyof typeof ORDER_TABS;
export const ORDER_TAB_KEYS = Object.keys(ORDER_TABS) as OrderTab[];

export const ORDER_SORTS = ['placedAt', 'total', 'code'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value && (values as readonly string[]).includes(value) ? (value as T[number]) : null,
    );

const optionalDate = z
  .string()
  .optional()
  .transform((value) => {
    if (!value || !DATE.test(value)) return null;
    const date = new Date(`${value}T00:00:00+07:00`);
    return Number.isNaN(date.getTime()) ? null : value;
  });

/**
 * URL filters of /admin/orders. Never fails: unknown values are dropped, so a stale or edited
 * URL shows the unfiltered list instead of an error.
 */
export const orderListFiltersSchema = z.object({
  tab: optionalEnum(ORDER_TAB_KEYS as [OrderTab, ...OrderTab[]]),
  status: optionalEnum(ORDER_STATUSES),
  paymentStatus: optionalEnum(PAYMENT_STATUSES),
  paymentMethod: optionalEnum(PAYMENT_METHODS),
  province: z
    .string()
    .optional()
    .transform((value) => (value && /^\d{2}$/.test(value) ? value : null)),
  /** Inclusive dates in Vietnam time (`YYYY-MM-DD`). */
  from: optionalDate,
  to: optionalDate,
});
export type OrderListFilters = z.output<typeof orderListFiltersSchema>;

export type OrderListQuery = OrderListFilters & {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
};

/** Raw URL params → filters (single values only; arrays take the first entry). */
export function parseOrderListFilters(
  raw: Record<string, string | string[] | undefined>,
): OrderListFilters {
  const pick = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return orderListFiltersSchema.parse({
    tab: pick('tab'),
    status: pick('status'),
    paymentStatus: pick('paymentStatus'),
    paymentMethod: pick('paymentMethod'),
    province: pick('province'),
    from: pick('from'),
    to: pick('to'),
  });
}

/** `[from, to)` UTC instants for an inclusive Vietnam-time date range. */
export function dateRangeBounds(filters: Pick<OrderListFilters, 'from' | 'to'>): {
  start: Date | null;
  end: Date | null;
} {
  const start = filters.from ? new Date(`${filters.from}T00:00:00+07:00`) : null;
  const end = filters.to
    ? new Date(new Date(`${filters.to}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000)
    : null;
  return { start, end };
}

const orderRef = {
  orderId: z.uuid({ error: 'invalid' }),
  /** Version the staff member loaded (optimistic lock, §11.2 order edits). */
  expectedVersion: z.number({ error: 'invalid' }).int().nonnegative(),
};

const reason = z
  .string()
  .trim()
  .max(500, { error: 'tooLong' })
  .nullish()
  .transform((value) => value || null);

/** Status buttons other than ship (needs a shipment) and cancel (needs a reason). */
export const ORDER_COMMAND_TARGETS = [
  'confirmed',
  'processing',
  'delivered',
  'delivery_failed',
  'returned',
  'return_requested',
] as const satisfies readonly OrderStatus[];

export const orderTransitionSchema = z.object({
  ...orderRef,
  to: z.enum(ORDER_COMMAND_TARGETS, { error: 'invalid' }),
  reason,
});
export type OrderTransitionInput = z.output<typeof orderTransitionSchema>;

export const cancelOrderSchema = z.object({
  ...orderRef,
  reason: z
    .string({ error: 'required' })
    .trim()
    .min(3, { error: 'reasonRequired' })
    .max(500, { error: 'tooLong' }),
});
export type CancelOrderInput = z.output<typeof cancelOrderSchema>;

/** Carrier tracking codes: letters, digits and `-_.`, as printed on GHN/GHTK labels. */
export const TRACKING_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$/;

export const shipOrderSchema = z.object({
  ...orderRef,
  carrier: z.enum(CARRIERS, { error: 'carrierRequired' }),
  trackingCode: z
    .string({ error: 'required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(TRACKING_CODE, { error: 'trackingCodeInvalid' })),
  feeActual: z
    .number()
    .int({ error: 'integer' })
    .min(0, { error: 'tooSmall' })
    .max(10_000_000, { error: 'tooLarge' })
    .nullish()
    .transform((value) => value ?? null),
});
export type ShipOrderInput = z.output<typeof shipOrderSchema>;

export const orderNoteSchema = z.object({
  orderId: z.uuid({ error: 'invalid' }),
  message: z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .max(1000, { error: 'tooLong' }),
});
export type OrderNoteInput = z.output<typeof orderNoteSchema>;

export const MAX_BULK_ORDERS = 50;

export const bulkOrdersSchema = z.object({
  orderIds: z
    .array(z.uuid({ error: 'invalid' }))
    .min(1, { error: 'required' })
    .max(MAX_BULK_ORDERS, { error: 'tooLarge' })
    .transform((ids) => [...new Set(ids)]),
});
export type BulkOrdersInput = z.output<typeof bulkOrdersSchema>;

export const PRINT_DOCUMENTS = ['packing-slip', 'delivery-slip'] as const;
export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];
