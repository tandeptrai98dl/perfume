import { z } from 'zod';

/** Staff retry of an order's e-invoice (`orders.process`). */
export const einvoiceRetrySchema = z.object({ orderId: z.uuid() });
export type EinvoiceRetryInput = z.output<typeof einvoiceRetrySchema>;

/** Staff cancellation / replacement of the order's invoice (`payments.refund`). */
export const einvoiceAdjustSchema = z.object({
  orderId: z.uuid(),
  reason: z
    .string({ error: 'required' })
    .trim()
    .min(5, { error: 'tooShort' })
    .max(300, { error: 'tooLong' }),
});
export type EinvoiceAdjustInput = z.output<typeof einvoiceAdjustSchema>;
