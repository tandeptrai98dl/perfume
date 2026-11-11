import { z } from 'zod';

import { normalizeVietnamesePhone, VN_MOBILE_PATTERN } from '@/lib/phone';

/*
 * Checkout form (§10.4), shared by the client form (React Hook Form resolver) and the Server
 * Action, so both validate the same rules. Error messages are translation codes under
 * `checkout.errors.*`. Prices are never part of the form: the server recomputes them
 * (`expectedTotal` is only compared, to tell the buyer when a price changed meanwhile).
 * Rules that need the database (province ↔ ward, shipping rate, coupon, stock) are checked
 * by `placeOrder`.
 */

export const CHECKOUT_PAYMENT_METHODS = ['cod', 'payos', 'vnpay'] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

export const ONLINE_PAYMENT_METHODS: readonly CheckoutPaymentMethod[] = ['payos', 'vnpay'];

export const CHECKOUT_LIMITS = {
  name: 100,
  street: 200,
  note: 500,
  email: 254,
  companyName: 200,
  couponCode: 40,
} as const;

/** Vietnamese tax code: 10 digits (company), 10-3 (branch) or 12 digits (personal ID, 2025+). */
export const TAX_CODE_PATTERN = /^(\d{10}(-\d{3})?|\d{12})$/;

const requiredText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? 'tooShort' : 'required')
    .max(max, 'tooLong');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'required')
  .max(CHECKOUT_LIMITS.email, 'tooLong')
  .pipe(z.email('emailInvalid'));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .transform(normalizeVietnamesePhone)
  .pipe(z.string().regex(VN_MOBILE_PATTERN, 'phoneInvalid'));

const unitCode = z
  .string()
  .trim()
  .regex(/^\d*$/, 'invalid')
  .max(10)
  .refine((value) => value.length > 0, 'selectRequired');

export const addressSchema = z.object({
  provinceCode: unitCode,
  wardCode: unitCode,
  street: requiredText(CHECKOUT_LIMITS.street, 3),
});

/** All fields are strings so the collapsed section can stay empty; checked when requested. */
const vatInvoiceInput = z.object({
  requested: z.boolean(),
  companyName: z.string().trim().max(CHECKOUT_LIMITS.companyName, 'tooLong'),
  taxCode: z.string().trim(),
  email: z.string().trim().toLowerCase().max(CHECKOUT_LIMITS.email, 'tooLong'),
  address: z.object({
    provinceCode: z.string().trim().max(10),
    wardCode: z.string().trim().max(10),
    street: z.string().trim().max(CHECKOUT_LIMITS.street, 'tooLong'),
  }),
});

export const checkoutFormSchema = z
  .object({
    locale: z.enum(['vi', 'en']),
    /** Generated when the checkout page renders; a repeated submit returns the first order. */
    checkoutKey: z
      .string()
      .min(16)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
    email,
    phone: phoneSchema,
    fullName: requiredText(CHECKOUT_LIMITS.name, 2),
    address: addressSchema,
    shippingRateId: z.uuid('shippingRequired'),
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHODS, 'paymentRequired'),
    couponCode: z.string().trim().max(CHECKOUT_LIMITS.couponCode, 'tooLong').default(''),
    customerNote: z.string().trim().max(CHECKOUT_LIMITS.note, 'tooLong').default(''),
    vatInvoice: vatInvoiceInput,
    consents: z.object({
      terms: z.literal(true, 'consentRequired'),
      privacy: z.literal(true, 'consentRequired'),
      marketing: z.boolean().default(false),
    }),
    expectedTotal: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    const vat = value.vatInvoice;
    if (!vat.requested) return;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: ['vatInvoice', ...path], message });
    if (vat.companyName.length < 2) issue(['companyName'], 'required');
    if (!TAX_CODE_PATTERN.test(vat.taxCode)) issue(['taxCode'], 'taxCodeInvalid');
    if (!z.email().safeParse(vat.email).success) issue(['email'], 'emailInvalid');
    if (!vat.address.provinceCode) issue(['address', 'provinceCode'], 'selectRequired');
    if (!vat.address.wardCode) issue(['address', 'wardCode'], 'selectRequired');
    if (vat.address.street.length < 3) issue(['address', 'street'], 'tooShort');
  })
  .transform(({ vatInvoice, ...rest }) => ({
    ...rest,
    couponCode: rest.couponCode || null,
    customerNote: rest.customerNote || null,
    vatInvoice: vatInvoice.requested
      ? {
          companyName: vatInvoice.companyName,
          taxCode: vatInvoice.taxCode,
          email: vatInvoice.email,
          address: vatInvoice.address,
        }
      : null,
  }));

export type CheckoutFormInput = z.input<typeof checkoutFormSchema>;
export type CheckoutFormOutput = z.output<typeof checkoutFormSchema>;

/** Inputs of the live order summary (shipping quotes, coupon, totals) while the form changes. */
export const checkoutQuoteSchema = z.object({
  locale: z.enum(['vi', 'en']),
  provinceCode: z.string().trim().max(10).regex(/^\d*$/).default(''),
  shippingRateId: z.union([z.uuid(), z.literal('')]).default(''),
  paymentMethod: z.union([z.enum(CHECKOUT_PAYMENT_METHODS), z.literal('')]).default(''),
  couponCode: z.string().trim().max(CHECKOUT_LIMITS.couponCode).default(''),
  /** Only used for the coupon's per-customer limit; validated loosely (the form validates). */
  email: z.string().trim().toLowerCase().max(CHECKOUT_LIMITS.email).default(''),
  phone: z.string().trim().max(20).default(''),
});

export type CheckoutQuoteInput = z.input<typeof checkoutQuoteSchema>;

/** Form state on the client: consent boxes start unticked (the schema requires `true`). */
export type CheckoutFormValues = Omit<CheckoutFormInput, 'consents' | 'paymentMethod'> & {
  paymentMethod: CheckoutPaymentMethod | '';
  consents: { terms: boolean; privacy: boolean; marketing: boolean };
};
