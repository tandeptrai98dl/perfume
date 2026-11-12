import { z } from 'zod';

import {
  COD_RISK_REASON_MAX,
  COD_RISK_REASON_MIN,
  CUSTOMER_NOTE_MAX,
  CUSTOMER_SORTS,
  CUSTOMER_TYPES,
} from './admin-constants';

/** Admin customer list, CSV export and customer commands (§11.2 "Customers"). */

const PAGE_SIZES = [20, 50, 100] as const;

/** Empty URL params (`?type=`) mean "no filter". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

export const customerFilterSchema = z.object({
  q: z.string().trim().max(100).catch('').default(''),
  type: optional(z.enum(CUSTOMER_TYPES)).catch(undefined),
  risk: optional(z.enum(['flagged'])).catch(undefined),
  sort: z.enum(CUSTOMER_SORTS).catch('lastOrder').default('lastOrder'),
  dir: z.enum(['asc', 'desc']).catch('desc').default('desc'),
});
export type CustomerFilter = z.output<typeof customerFilterSchema>;

export const customerListSchema = customerFilterSchema.extend({
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => (PAGE_SIZES as readonly number[]).includes(value))
    .catch(20)
    .default(20),
});
export type CustomerListQuery = z.output<typeof customerListSchema>;

export const setCodRiskFlagSchema = z.object({
  userId: z.uuid(),
  flagged: z.boolean(),
  reason: z
    .string()
    .trim()
    .min(COD_RISK_REASON_MIN, 'tooShort')
    .max(COD_RISK_REASON_MAX, 'tooLong'),
});
export type SetCodRiskFlagInput = z.output<typeof setCodRiskFlagSchema>;

export const customerNoteSchema = z.object({
  userId: z.uuid(),
  note: z.string().trim().min(1, 'required').max(CUSTOMER_NOTE_MAX, 'tooLong'),
});
export type CustomerNoteInput = z.output<typeof customerNoteSchema>;
