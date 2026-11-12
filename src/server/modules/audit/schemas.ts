import { z } from 'zod';

/** Audit log filters (§11.2: actor, entity, action, date) and keyset cursor. */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

/** Empty strings from URL params mean "no filter". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullish());

export const auditFilterSchema = z.object({
  actorId: optional(z.uuid()),
  entityType: optional(z.string().regex(/^[a-z][a-z_]{0,39}$/)),
  entityId: optional(z.string().trim().min(1).max(100)),
  /** Prefix match on the dotted action name, e.g. `order.` or `staff.role_change`. */
  action: optional(
    z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_.]{1,60}$/),
  ),
  /** Vietnam calendar dates, inclusive. */
  from: optional(isoDate),
  to: optional(isoDate),
});
export type AuditFilter = z.output<typeof auditFilterSchema>;

export const AUDIT_PAGE_SIZE = 50;
/** Hard cap of one CSV export; narrow the filters for more. */
export const AUDIT_EXPORT_LIMIT = 10_000;

export const auditPageSchema = auditFilterSchema.extend({
  cursor: optional(z.uuid()),
  /** `older` pages towards the past (default), `newer` back towards the present. */
  dir: z.enum(['older', 'newer']).catch('older').default('older'),
});
export type AuditPageQuery = z.output<typeof auditPageSchema>;
