import { z } from 'zod';

/* Admin inputs for /admin/shipping (zones + weight-band rates, §11.2 Shipping). */

const MAX_FEE = 10_000_000;

const optionalId = z
  .uuid({ error: 'invalid' })
  .nullish()
  .transform((value) => value ?? null);

export const shippingZoneSchema = z.object({
  id: optionalId,
  name: z.string({ error: 'required' }).trim().min(1, { error: 'required' }).max(80, {
    error: 'tooLong',
  }),
  provinceCodes: z
    .array(z.string().regex(/^\d{2}$/, { error: 'invalid' }))
    .min(1, { error: 'provincesRequired' })
    .max(100)
    .transform((codes) => [...new Set(codes)].sort()),
  position: z.number().int({ error: 'integer' }).min(0, { error: 'tooSmall' }).max(1000).default(0),
});
export type ShippingZoneInput = z.output<typeof shippingZoneSchema>;

const name = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .max(80, { error: 'tooLong' });

export const shippingRateSchema = z
  .object({
    id: optionalId,
    zoneId: z.uuid({ error: 'invalid' }),
    names: z.object({ vi: name, en: name }),
    minWeightG: z.number({ error: 'required' }).int({ error: 'integer' }).min(0, {
      error: 'tooSmall',
    }),
    maxWeightG: z
      .number()
      .int({ error: 'integer' })
      .positive({ error: 'tooSmall' })
      .nullish()
      .transform((value) => value ?? null),
    fee: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(0, { error: 'tooSmall' })
      .max(MAX_FEE, { error: 'tooLarge' }),
    freeOverSubtotal: z
      .number()
      .int({ error: 'integer' })
      .positive({ error: 'tooSmall' })
      .max(1_000_000_000, { error: 'tooLarge' })
      .nullish()
      .transform((value) => value ?? null),
    etaMinDays: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(0, {
        error: 'tooSmall',
      })
      .max(60, { error: 'tooLarge' }),
    etaMaxDays: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(0, {
        error: 'tooSmall',
      })
      .max(60, { error: 'tooLarge' }),
    isActive: z.boolean().default(true),
    position: z.number().int({ error: 'integer' }).min(0).max(1000).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.maxWeightG !== null && value.maxWeightG <= value.minWeightG) {
      ctx.addIssue({ code: 'custom', path: ['maxWeightG'], message: 'maxWeightNotHigher' });
    }
    if (value.etaMaxDays < value.etaMinDays) {
      ctx.addIssue({ code: 'custom', path: ['etaMaxDays'], message: 'etaMaxBeforeMin' });
    }
  });
export type ShippingRateInput = z.output<typeof shippingRateSchema>;

export const shippingRateActiveSchema = z.object({
  id: z.uuid({ error: 'invalid' }),
  isActive: z.boolean(),
});
export type ShippingRateActiveInput = z.output<typeof shippingRateActiveSchema>;

export const shippingEntityIdSchema = z.object({ id: z.uuid({ error: 'invalid' }) });
export type ShippingEntityIdInput = z.output<typeof shippingEntityIdSchema>;
