import { z } from 'zod';

/** Staff retry of an order's e-invoice (`orders.process`). */
export const einvoiceRetrySchema = z.object({ orderId: z.uuid() });
export type EinvoiceRetryInput = z.output<typeof einvoiceRetrySchema>;
