import { z } from 'zod';

import { addressSchema, CHECKOUT_LIMITS } from '@/lib/checkout/form-schema';
import { normalizeVietnamesePhone, VN_MOBILE_PATTERN } from '@/lib/phone';

import type { OrderPaymentMethod } from './rules';

/*
 * Manual order form (§11.2 `/admin/orders/new`). Prices are never part of it: the server
 * recomputes everything with `placeOrder`. Error messages are codes under `admin.errors.*`.
 * Phone and e-mail may stay empty when a lookup match was chosen: the server fills them from
 * that match (staff only ever saw them masked).
 */

export const MANUAL_PAYMENT_OPTIONS = ['cod', 'bank_transfer', 'payment_link'] as const;
export type ManualPaymentOption = (typeof MANUAL_PAYMENT_OPTIONS)[number];

export const PAYMENT_LINK_PROVIDERS = ['payos', 'vnpay'] as const;
export type PaymentLinkProvider = (typeof PAYMENT_LINK_PROVIDERS)[number];

export const MANUAL_ORDER_LIMITS = { lines: 30, quantity: 99, note: 500 } as const;

const optionalPhone = z
  .string()
  .trim()
  .max(20, 'tooLong')
  .default('')
  .transform((value) => (value ? normalizeVietnamesePhone(value) : ''))
  .refine((value) => !value || VN_MOBILE_PATTERN.test(value), 'phoneInvalid');

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(CHECKOUT_LIMITS.email, 'tooLong')
  .default('')
  .refine((value) => !value || z.email().safeParse(value).success, 'emailInvalid');

export const customerRefSchema = z.object({
  type: z.enum(['user', 'order']),
  id: z.uuid(),
});

export const manualOrderSchema = z
  .object({
    checkoutKey: z
      .string()
      .min(16)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
    customer: z.object({
      ref: customerRefSchema.nullable().default(null),
      fullName: z.string().trim().min(2, 'required').max(CHECKOUT_LIMITS.name, 'tooLong'),
      phone: optionalPhone,
      email: optionalEmail,
      locale: z.enum(['vi', 'en'], 'required'),
    }),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          quantity: z
            .number('integer')
            .int('integer')
            .min(1, 'tooSmall')
            .max(MANUAL_ORDER_LIMITS.quantity, 'tooLarge'),
        }),
      )
      .min(1, 'itemsRequired')
      .max(MANUAL_ORDER_LIMITS.lines, 'tooLarge'),
    address: addressSchema,
    shippingRateId: z.uuid('shippingRequired'),
    couponCode: z.string().trim().max(CHECKOUT_LIMITS.couponCode, 'tooLong').default(''),
    paymentOption: z.enum(MANUAL_PAYMENT_OPTIONS, 'paymentRequired'),
    linkProvider: z.enum(PAYMENT_LINK_PROVIDERS).default('payos'),
    /** COD: the customer already confirmed on the phone → `confirmed` right away. */
    confirmNow: z.boolean().default(true),
    /** Bank transfer already on the statement (Manager/Owner only). */
    transfer: z
      .object({
        received: z.boolean().default(false),
        bankReference: z.string().trim().max(100, 'tooLong').default(''),
      })
      .default({ received: false, bankReference: '' }),
    staffNote: z.string().trim().max(MANUAL_ORDER_LIMITS.note, 'tooLong').default(''),
  })
  .superRefine((value, ctx) => {
    if (!value.customer.ref && !value.customer.phone) {
      ctx.addIssue({ code: 'custom', path: ['customer', 'phone'], message: 'required' });
    }
    if (
      value.paymentOption === 'bank_transfer' &&
      value.transfer.received &&
      !value.transfer.bankReference
    ) {
      ctx.addIssue({ code: 'custom', path: ['transfer', 'bankReference'], message: 'required' });
    }
  })
  .transform((value) => ({
    ...value,
    couponCode: value.couponCode || null,
    staffNote: value.staffNote || null,
  }));

export type ManualOrderInput = z.output<typeof manualOrderSchema>;
export type ManualOrderRawInput = z.input<typeof manualOrderSchema>;

/** Live summary of the manual order form (read only). */
export const manualQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1).max(MANUAL_ORDER_LIMITS.quantity),
      }),
    )
    .max(MANUAL_ORDER_LIMITS.lines),
  provinceCode: z.string().trim().max(10).regex(/^\d*$/).default(''),
  shippingRateId: z.union([z.uuid(), z.literal('')]).default(''),
  paymentOption: z.union([z.enum(MANUAL_PAYMENT_OPTIONS), z.literal('')]).default(''),
  linkProvider: z.enum(PAYMENT_LINK_PROVIDERS).default('payos'),
  couponCode: z.string().trim().max(CHECKOUT_LIMITS.couponCode).default(''),
  customer: z
    .object({
      ref: customerRefSchema.nullable().default(null),
      phone: z.string().trim().max(20).default(''),
      email: z.string().trim().toLowerCase().max(CHECKOUT_LIMITS.email).default(''),
    })
    .default({ ref: null, phone: '', email: '' }),
});

export type ManualQuoteInput = z.output<typeof manualQuoteSchema>;

export const customerLookupSchema = z
  .object({ query: z.string().trim().min(1, 'required').max(CHECKOUT_LIMITS.email, 'tooLong') })
  .transform(({ query }) =>
    query.includes('@')
      ? { phone: null, email: query.toLowerCase() }
      : { phone: normalizeVietnamesePhone(query), email: null },
  );

export const variantSearchSchema = z.object({ q: z.string().trim().max(100) });

// ---------- Pure decisions (unit-tested) ----------

/** Order payment method of a manual order. */
export function manualPaymentMethod(
  option: ManualPaymentOption,
  provider: PaymentLinkProvider,
): OrderPaymentMethod {
  if (option === 'payment_link') return provider;
  return option;
}

export type ManualFollowUp = {
  /** COD without deposit, confirmed on the phone: `awaiting_confirmation` → `confirmed`. */
  confirm: boolean;
  /** Record the bank transfer the Manager already saw (`payments.confirmBankTransfer`). */
  recordTransfer: boolean;
  /** Open a payment session (full amount, or the COD deposit) and hand out the link. */
  paymentLink: PaymentLinkProvider | null;
};

/**
 * What happens right after the order is placed (§3.4 steps 3, 5, 7): COD above the threshold
 * needs its deposit online first (D16), so it gets a deposit link instead of a confirmation.
 */
export function manualFollowUp(input: {
  option: ManualPaymentOption;
  provider: PaymentLinkProvider;
  depositRequired: number;
  confirmNow: boolean;
  transferReceived: boolean;
}): ManualFollowUp {
  switch (input.option) {
    case 'cod':
      return input.depositRequired > 0
        ? { confirm: false, recordTransfer: false, paymentLink: input.provider }
        : { confirm: input.confirmNow, recordTransfer: false, paymentLink: null };
    case 'bank_transfer':
      return { confirm: false, recordTransfer: input.transferReceived, paymentLink: null };
    case 'payment_link':
      return { confirm: false, recordTransfer: false, paymentLink: input.provider };
  }
}

/**
 * Contact used for the order: what staff typed wins, the chosen lookup match fills the gaps.
 * Returns the missing field when the phone is still unknown.
 */
export function mergeManualContact(
  typed: { fullName: string; phone: string; email: string; locale: 'vi' | 'en' },
  match: { userId: string | null; phone: string | null; email: string | null } | null,
):
  | {
      ok: true;
      contact: {
        userId: string | null;
        fullName: string;
        phone: string;
        email: string;
        locale: 'vi' | 'en';
      };
    }
  | { ok: false; field: 'phone' } {
  const phone = typed.phone || match?.phone || '';
  if (!phone || !VN_MOBILE_PATTERN.test(normalizeVietnamesePhone(phone))) {
    return { ok: false, field: 'phone' };
  }
  return {
    ok: true,
    contact: {
      userId: match?.userId ?? null,
      fullName: typed.fullName,
      phone: normalizeVietnamesePhone(phone),
      email: typed.email || match?.email || '',
      locale: typed.locale,
    },
  };
}
