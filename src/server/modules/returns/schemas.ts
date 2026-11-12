import { z } from 'zod';

import { RETURN_REASONS, RETURN_RESOLUTIONS } from '@/server/modules/order';

import { isFaultReason, RETURN_DESCRIPTION_MAX, RETURN_DESCRIPTION_MIN_FAULT } from './rules';

/*
 * Inputs of the return flow. Error messages are translation codes (`returns.errors.*` on the
 * storefront, `admin.returns.errors.*` in the admin).
 */

const MAX_LINES = 50;
/** Return shipping reimbursed to the customer, VND (sanity cap; the money cap is the ledger). */
export const MAX_RETURN_SHIPPING_FEE = 2_000_000;

export const returnRequestSchema = z
  .object({
    lines: z
      .array(
        z.object({
          orderItemId: z.uuid({ error: 'invalid' }),
          quantity: z
            .number({ error: 'required' })
            .int({ error: 'integer' })
            .min(1, { error: 'tooSmall' })
            .max(99, { error: 'tooLarge' }),
        }),
      )
      .min(1, { error: 'noLines' })
      .max(MAX_LINES, { error: 'tooMany' }),
    reason: z.enum(RETURN_REASONS, { error: 'reasonRequired' }),
    resolution: z.enum(RETURN_RESOLUTIONS, { error: 'invalid' }).default('refund'),
    description: z.string().trim().max(RETURN_DESCRIPTION_MAX, { error: 'tooLong' }).default(''),
    sealIntact: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.reason === 'unopened') {
      if (!value.sealIntact)
        ctx.addIssue({ code: 'custom', path: ['sealIntact'], message: 'sealRequired' });
      if (value.resolution !== 'refund') {
        ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'refundOnly' });
      }
    }
    if (isFaultReason(value.reason) && value.description.length < RETURN_DESCRIPTION_MIN_FAULT) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'describeProblem' });
    }
  });
export type ReturnRequestInput = z.output<typeof returnRequestSchema>;

const target = { orderId: z.uuid(), requestId: z.uuid() };

export const approveReturnSchema = z.object({
  ...target,
  note: z
    .string()
    .trim()
    .max(500, { error: 'tooLong' })
    .nullish()
    .transform((value) => value || null),
});
export type ApproveReturnInput = z.output<typeof approveReturnSchema>;

export const rejectReturnSchema = z.object({
  ...target,
  reason: z
    .string({ error: 'required' })
    .trim()
    .min(5, { error: 'tooShort' })
    .max(500, { error: 'tooLong' }),
});
export type RejectReturnInput = z.output<typeof rejectReturnSchema>;

export const receiveReturnSchema = z.object({
  ...target,
  /** Returned units go back to sellable stock (unopened, seal intact). */
  resellable: z.boolean(),
  returnShippingFee: z
    .number({ error: 'required' })
    .int({ error: 'integer' })
    .min(0, { error: 'tooSmall' })
    .max(MAX_RETURN_SHIPPING_FEE, { error: 'tooLarge' })
    .default(0),
  note: z
    .string()
    .trim()
    .max(500, { error: 'tooLong' })
    .nullish()
    .transform((value) => value || null),
});
export type ReceiveReturnInput = z.output<typeof receiveReturnSchema>;
