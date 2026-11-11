import { z } from 'zod';

/*
 * Admin (write side) inputs for inventory. Error messages are codes translated by the UI.
 * Staff record purchases, returns, damage and count corrections; `sale`, `reserve` and
 * `release` movements come only from orders (M2).
 */

export const ADJUSTMENT_REASONS = ['purchase', 'return', 'damage', 'adjustment'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_MODES = ['delta', 'set'] as const;
export type AdjustmentMode = (typeof ADJUSTMENT_MODES)[number];

export const MAX_STOCK_QUANTITY = 100_000;

export const stockAdjustSchema = z.object({
  variantId: z.uuid({ error: 'invalid' }),
  /** `delta`: add/remove units; `set`: the counted quantity on hand. */
  mode: z.enum(ADJUSTMENT_MODES).default('delta'),
  quantity: z
    .number({ error: 'required' })
    .int({ error: 'integer' })
    .min(-MAX_STOCK_QUANTITY, { error: 'tooSmall' })
    .max(MAX_STOCK_QUANTITY, { error: 'tooLarge' }),
  reason: z.enum(ADJUSTMENT_REASONS, { error: 'reasonRequired' }),
  note: z
    .union([z.string().trim().max(500, { error: 'tooLong' }), z.null(), z.undefined()])
    .transform((value) => value || null),
});
export type StockAdjustInput = z.output<typeof stockAdjustSchema>;

export const lowStockThresholdSchema = z.object({
  variantId: z.uuid({ error: 'invalid' }),
  lowStockThreshold: z.number().int({ error: 'integer' }).min(0, { error: 'tooSmall' }).max(10_000),
});
export type LowStockThresholdInput = z.output<typeof lowStockThresholdSchema>;
