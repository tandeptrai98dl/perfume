import { z } from 'zod';

import { normalizeVietnamesePhone, VN_MOBILE_PATTERN } from '@/lib/phone';

/*
 * Inputs of an admin order edit before shipment (§3.4 step 8, §11.2 "Order edits"). Error
 * messages are translation codes (`admin.errors.<code>`). Prices are never part of the input:
 * the server reprices the lines (snapshot price for kept lines, catalogue price for new ones).
 */

/** Line cap of one order (the per-line quantity cap comes from the commerce settings). */
export const MAX_EDIT_LINES = 30;
export const MAX_EDIT_QUANTITY = 99;
export const EDIT_LIMITS = { name: 100, street: 200, reason: 500 } as const;

const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? 'tooShort' : 'required')
    .max(max, 'tooLong');

const unitCode = z
  .string()
  .trim()
  .regex(/^\d{1,10}$/, 'selectRequired');

export const orderEditAddressSchema = z.object({
  fullName: text(EDIT_LIMITS.name),
  phone: z
    .string()
    .trim()
    .min(1, 'required')
    .transform(normalizeVietnamesePhone)
    .pipe(z.string().regex(VN_MOBILE_PATTERN, 'phoneInvalid')),
  provinceCode: unitCode,
  wardCode: unitCode,
  street: text(EDIT_LIMITS.street, 3),
});

export const orderEditLineSchema = z.object({
  variantId: z.uuid(),
  quantity: z
    .number('integer')
    .int('integer')
    .min(1, 'tooSmall')
    .max(MAX_EDIT_QUANTITY, 'tooLarge'),
});

/**
 * Manager-only override of the shipping fee (with a reason). `amount = null` removes an
 * earlier override (back to the rate table). Omitted = keep whatever applies now.
 */
export const shippingFeeOverrideSchema = z.object({
  amount: z
    .number('integer')
    .int('integer')
    .min(0, 'tooSmall')
    .max(10_000_000, 'tooLarge')
    .nullable(),
  reason: text(EDIT_LIMITS.reason, 3),
});

export const orderEditSchema = z.object({
  orderId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  address: orderEditAddressSchema,
  items: z
    .array(orderEditLineSchema)
    .min(1, 'itemsRequired')
    .max(MAX_EDIT_LINES, 'tooLarge')
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.variantId)) {
          ctx.addIssue({ code: 'custom', message: 'duplicate', path: [index, 'variantId'] });
        }
        seen.add(item.variantId);
      });
    }),
  shippingFeeOverride: shippingFeeOverrideSchema.nullish(),
  /** Optional note shown on the timeline (why the order was changed). */
  note: z.string().trim().max(EDIT_LIMITS.reason, 'tooLong').nullish(),
});
export type OrderEditInput = z.output<typeof orderEditSchema>;
export type OrderEditFormInput = z.input<typeof orderEditSchema>;

export const editVariantSearchSchema = z.object({
  orderId: z.uuid(),
  q: z.string().trim().max(80).default(''),
});
export type EditVariantSearchInput = z.output<typeof editVariantSearchSchema>;
