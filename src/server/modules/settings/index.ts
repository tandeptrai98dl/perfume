import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@/server/db/client';
import { settings } from '@/server/db/schema';

/**
 * Typed operational settings (no secrets, ADR-0007). Defaults mirror the seed so a missing row
 * never breaks checkout. Read-only here; the admin settings screen (M3) owns writes.
 */
const commerceSchema = z.object({
  'cod.maxOrderWithoutDeposit': z.number().int().nonnegative().default(5_000_000),
  'cod.depositPercent': z.number().int().min(0).max(100).default(20),
  'cod.confirmationWindowHours': z.number().int().positive().default(24),
  'checkout.paymentSessionMinutes': z.number().int().positive().default(15),
  'checkout.onlineReservationMinutes': z.number().int().positive().default(30),
  'cart.maxQuantityPerLine': z.number().int().positive().default(5),
  'giftWrap.fee': z.number().int().nonnegative().default(50_000),
  'returns.windowDays': z.number().int().positive().default(7),
});

export type CommerceSettings = {
  cod: { maxOrderWithoutDeposit: number; depositPercent: number; confirmationWindowHours: number };
  checkout: { paymentSessionMinutes: number; onlineReservationMinutes: number };
  cart: { maxQuantityPerLine: number };
  giftWrapFee: number;
  returnsWindowDays: number;
};

export async function getCommerceSettings(db: Pick<Database, 'select'>): Promise<CommerceSettings> {
  const keys = Object.keys(commerceSchema.shape);
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const raw = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const parsed = commerceSchema.safeParse(raw);
  const v = parsed.success ? parsed.data : commerceSchema.parse({});
  return {
    cod: {
      maxOrderWithoutDeposit: v['cod.maxOrderWithoutDeposit'],
      depositPercent: v['cod.depositPercent'],
      confirmationWindowHours: v['cod.confirmationWindowHours'],
    },
    checkout: {
      paymentSessionMinutes: v['checkout.paymentSessionMinutes'],
      onlineReservationMinutes: v['checkout.onlineReservationMinutes'],
    },
    cart: { maxQuantityPerLine: v['cart.maxQuantityPerLine'] },
    giftWrapFee: v['giftWrap.fee'],
    returnsWindowDays: v['returns.windowDays'],
  };
}

// ---------- M3 e-invoicing (D13) ----------
/**
 * VAT rate applied to every invoice line (goods and fees), in percent. Default 10 % (standard
 * rate for perfume/cosmetics) — PENDING ACCOUNTANT CONFIRMATION (ADR-0013): a temporary
 * reduced rate (8 %) may apply in some periods. Prices are VAT-inclusive; the invoice splits
 * each line into taxable amount + VAT. Stored as the `einvoice.vatRatePercent` setting.
 */
export const EINVOICE_VAT_RATES = [0, 5, 8, 10] as const;
const einvoiceSchema = z.object({
  'einvoice.vatRatePercent': z
    .number()
    .int()
    .refine((rate) => (EINVOICE_VAT_RATES as readonly number[]).includes(rate))
    .default(10),
});

export type EinvoiceSettings = { vatRatePercent: number };

export async function getEinvoiceSettings(db: Pick<Database, 'select'>): Promise<EinvoiceSettings> {
  const keys = Object.keys(einvoiceSchema.shape);
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const parsed = einvoiceSchema.safeParse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  return { vatRatePercent: parsed.success ? parsed.data['einvoice.vatRatePercent'] : 10 };
}
