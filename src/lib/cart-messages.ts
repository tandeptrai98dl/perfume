import type { CartCouponRejection, CouponRejectionDetail } from '@/server/modules/cart';

/** Translation key and ICU values of a coupon rejection (`cart.coupon.errors.*`). */
export function couponRejectionMessage(detail: CouponRejectionDetail): {
  key: `errors.${CartCouponRejection}`;
  values: Record<string, number>;
} {
  const values: Record<string, number> = {};
  if (detail.reason === 'min_subtotal') {
    values.minSubtotal = detail.minSubtotal ?? 0;
    values.missing = Math.max(0, detail.missing ?? 0);
  }
  return { key: `errors.${detail.reason}`, values };
}
