import { z } from 'zod';

/*
 * Admin coupon inputs (§11.2 Coupons). `value` is a whole percent for `percent`, VND for
 * `fixed`, 0 for `free_shipping`. Dates arrive as ISO strings (entered in Vietnam time).
 */

export const COUPON_TYPES = ['percent', 'fixed', 'free_shipping'] as const;
export type CouponTypeValue = (typeof COUPON_TYPES)[number];

/** Codes are read over the phone and typed at checkout: letters, digits, `-` and `_`. */
export const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

const MAX_MONEY = 1_000_000_000;

const optionalMoney = z
  .number()
  .int({ error: 'integer' })
  .positive({ error: 'tooSmall' })
  .max(MAX_MONEY, { error: 'tooLarge' })
  .nullish()
  .transform((value) => value ?? null);

const optionalCount = z
  .number()
  .int({ error: 'integer' })
  .positive({ error: 'tooSmall' })
  .max(1_000_000, { error: 'tooLarge' })
  .nullish()
  .transform((value) => value ?? null);

const optionalDate = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'invalid' });
      return z.NEVER;
    }
    return date;
  });

const ids = z
  .array(z.uuid({ error: 'invalid' }))
  .max(200, { error: 'tooLarge' })
  .default([])
  .transform((list) => [...new Set(list)]);

export const couponScopeSchema = z.object({
  brandIds: ids,
  categoryIds: ids,
  productIds: ids,
});
export type CouponScopeInput = z.output<typeof couponScopeSchema>;

export const couponSchema = z
  .object({
    id: z
      .uuid({ error: 'invalid' })
      .nullish()
      .transform((value) => value ?? null),
    code: z
      .string({ error: 'required' })
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(COUPON_CODE, { error: 'couponCodeInvalid' })),
    type: z.enum(COUPON_TYPES, { error: 'required' }),
    value: z
      .number({ error: 'required' })
      .int({ error: 'integer' })
      .min(0, { error: 'tooSmall' })
      .max(MAX_MONEY, { error: 'tooLarge' }),
    maxDiscount: optionalMoney,
    minSubtotal: optionalMoney,
    startsAt: optionalDate,
    endsAt: optionalDate,
    usageLimit: optionalCount,
    perCustomerLimit: optionalCount,
    scope: couponScopeSchema.default({ brandIds: [], categoryIds: [], productIds: [] }),
    excludeSaleItems: z.boolean().default(false),
    isActive: z.boolean().default(true),
    note: z
      .string()
      .trim()
      .max(500, { error: 'tooLong' })
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'percent' && (value.value < 1 || value.value > 100)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'percentRange' });
    }
    if (value.type === 'fixed' && value.value < 1) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'tooSmall' });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endBeforeStart' });
    }
    if (
      value.usageLimit !== null &&
      value.perCustomerLimit !== null &&
      value.perCustomerLimit > value.usageLimit
    ) {
      ctx.addIssue({ code: 'custom', path: ['perCustomerLimit'], message: 'tooLarge' });
    }
  })
  .transform((value) => ({
    ...value,
    // Free shipping has no amount; a cap only makes sense for percentages.
    value: value.type === 'free_shipping' ? 0 : value.value,
    maxDiscount: value.type === 'percent' ? value.maxDiscount : null,
  }));
export type CouponInput = z.output<typeof couponSchema>;

export const couponActiveSchema = z.object({
  id: z.uuid({ error: 'invalid' }),
  isActive: z.boolean(),
});
export type CouponActiveInput = z.output<typeof couponActiveSchema>;

export const COUPON_SORTS = ['code', 'createdAt', 'usedCount', 'endsAt'] as const;
export type CouponSort = (typeof COUPON_SORTS)[number];

export const COUPON_STATES = ['active', 'scheduled', 'expired', 'inactive'] as const;
export type CouponState = (typeof COUPON_STATES)[number];

/** Display state: switched off, not started, ended or used up, otherwise active. */
export function couponState(
  coupon: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usedCount: number;
  },
  now: Date = new Date(),
): CouponState {
  if (!coupon.isActive) return 'inactive';
  if (coupon.endsAt && coupon.endsAt <= now) return 'expired';
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return 'expired';
  if (coupon.startsAt && coupon.startsAt > now) return 'scheduled';
  return 'active';
}
