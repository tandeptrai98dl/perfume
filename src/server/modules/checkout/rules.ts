import type { CheckoutPaymentMethod } from '@/lib/checkout/form-schema';
import type { FieldIssue } from '@/server/lib/command-context';
import type { CartLine } from '@/server/modules/cart';
import type { CommerceSettings } from '@/server/modules/settings';

import type { PricingResult } from './pricing';

/*
 * Pure checkout decisions (ARCHITECTURE.md §3.4 steps 1–2, ADR-0006, ADR-0016), unit-tested
 * apart from the transaction in `place-order.ts`.
 */

export type InitialOrderStatus = 'pending' | 'awaiting_confirmation';

/**
 * Payment methods an order can be placed with: the storefront ones plus `bank_transfer`, which
 * only staff offer on manual orders (§3.4 step 7; money confirmed by a Manager).
 */
export type OrderPaymentMethod = CheckoutPaymentMethod | 'bank_transfer';

export function isOnlineMethod(method: OrderPaymentMethod): boolean {
  return method !== 'cod';
}

/**
 * Online payment (payOS VietQR, VNPay) and COD orders that need a deposit wait for money:
 * `pending` (→ `confirmed` by the payment module). Other COD orders wait for staff:
 * `awaiting_confirmation`.
 */
export function decideInitialStatus(
  method: OrderPaymentMethod,
  depositRequired: number,
): InitialOrderStatus {
  return isOnlineMethod(method) || depositRequired > 0 ? 'pending' : 'awaiting_confirmation';
}

/**
 * Reservation lifetime (ADR-0006): orders waiting for a payment (online or COD deposit) hold
 * stock for `checkout.onlineReservationMinutes`; orders waiting for staff hold it for
 * `cod.confirmationWindowHours` — COD orders awaiting confirmation, and manual bank-transfer
 * orders, whose money is confirmed by a Manager from the bank statement (no gateway IPN).
 */
export function reservationExpiry(
  status: InitialOrderStatus,
  settings: Pick<CommerceSettings, 'checkout' | 'cod'>,
  now: Date = new Date(),
  method?: OrderPaymentMethod,
): Date {
  const ms =
    status === 'pending' && method !== 'bank_transfer'
      ? settings.checkout.onlineReservationMinutes * 60_000
      : settings.cod.confirmationWindowHours * 3_600_000;
  return new Date(now.getTime() + ms);
}

/**
 * Lines that cannot be ordered as they are, one issue per line (`path` = `items.<variantId>`):
 * no longer sold, above the per-line cap (§10.3), or above the available stock.
 */
export function checkCartLines(
  lines: readonly Pick<CartLine, 'variantId' | 'quantity' | 'available' | 'purchasable'>[],
  maxQuantityPerLine: number,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const line of lines) {
    const path = `items.${line.variantId}`;
    if (!line.purchasable) issues.push({ path, code: 'itemUnavailable' });
    else if (line.quantity > maxQuantityPerLine) issues.push({ path, code: 'itemQuantityLimit' });
    else if (line.quantity > line.available) issues.push({ path, code: 'itemInsufficientStock' });
  }
  return issues;
}

/** Value granted by the coupon, stored on `coupon_redemptions.amount`. */
export function couponRedemptionAmount(
  couponType: 'percent' | 'fixed' | 'free_shipping',
  pricing: Pick<PricingResult, 'discountTotal' | 'shippingDiscount'>,
): number {
  return couponType === 'free_shipping' ? pricing.shippingDiscount : pricing.discountTotal;
}

/** Staff are alerted about COD orders above the no-deposit threshold (ADR-0016, ADR-0019). */
export function isHighValueCod(
  method: OrderPaymentMethod,
  total: number,
  settings: Pick<CommerceSettings, 'cod'>,
): boolean {
  return method === 'cod' && total > settings.cod.maxOrderWithoutDeposit;
}

/** "12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh" (VAT invoice address text). */
export function formatAddressLine(parts: {
  street: string;
  wardName: string;
  provinceName: string;
}): string {
  return [parts.street, parts.wardName, parts.provinceName].filter(Boolean).join(', ');
}
