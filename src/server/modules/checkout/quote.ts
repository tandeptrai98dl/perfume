import type { Locale } from '@/i18n/routing';
import type { CheckoutPaymentMethod } from '@/lib/checkout/form-schema';
import type { Database } from '@/server/db/client';
import type { FieldIssue } from '@/server/lib/command-context';
import type { CartRow } from '@/server/modules/cart';

import { evaluateCheckout, type CouponIssueCode } from './evaluate';

/*
 * Live order summary for the checkout page (§10.4: summary + coupon beside the form). Read
 * only; `placeOrder` recomputes everything again inside its transaction.
 */

export type CheckoutQuoteLine = {
  variantId: string;
  productName: string;
  brandName: string;
  variantLabel: string;
  sku: string;
  imageStorageKey: string | null;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  discount: number;
  lineTotal: number;
};

export type CheckoutQuoteShipping = {
  rateId: string;
  name: string;
  fee: number;
  freeOverSubtotal: number | null;
  etaMinDays: number;
  etaMaxDays: number;
};

export type CheckoutQuote = {
  lines: CheckoutQuoteLine[];
  lineIssues: FieldIssue[];
  shippingOptions: CheckoutQuoteShipping[];
  shippingRateId: string | null;
  coupon: { code: string; applied: boolean; issue: CouponIssueCode | null } | null;
  totals: {
    subtotal: number;
    discountTotal: number;
    /** Null until a province (and so a rate) is known. */
    shippingFee: number | null;
    shippingDiscount: number;
    giftWrapFee: number;
    total: number;
    depositRequired: number;
  };
  gift: { wrap: boolean; message: string | null; hidePrices: boolean };
  cod: { maxOrderWithoutDeposit: number; depositPercent: number };
};

/**
 * Coupon guesses through the live quote count against the same per-cart limit as the cart's
 * "Apply" (§12 coupon attempts: 10/min/cart), or the quote would be a free brute-force
 * oracle. Only a code other than the one already applied to the cart is an attempt; codes
 * are compared like the coupon lookup does (case-insensitive).
 */
export function isCouponAttempt(
  code: string | null | undefined,
  cartCouponCode: string | null | undefined,
): boolean {
  const next = code?.trim().toUpperCase();
  return !!next && next !== cartCouponCode?.trim().toUpperCase();
}

/** The quote answered without evaluating `code` (limit reached): nothing about it leaks. */
export function withCouponRateLimited(quote: CheckoutQuote, code: string): CheckoutQuote {
  return { ...quote, coupon: { code: code.trim(), applied: false, issue: 'couponRateLimited' } };
}

export async function quoteCheckout(
  db: Pick<Database, 'select' | 'execute'>,
  input: {
    cart: Pick<CartRow, 'id' | 'giftWrap' | 'giftMessage' | 'hidePrices'>;
    locale: Locale;
    provinceCode?: string | null;
    shippingRateId?: string | null;
    paymentMethod?: CheckoutPaymentMethod | null;
    couponCode?: string | null;
    customer?: { phone?: string; email?: string; userId?: string | null };
  },
): Promise<CheckoutQuote> {
  const evaluation = await evaluateCheckout(db, { ...input, defaultRate: true });
  const { pricing } = evaluation;
  const code = input.couponCode?.trim();

  return {
    lines: evaluation.lines.map((line) => {
      const discount = pricing.lineDiscounts[line.variantId] ?? 0;
      return {
        variantId: line.variantId,
        productName: line.productName,
        brandName: line.brandName,
        variantLabel: line.variantLabel,
        sku: line.sku,
        imageStorageKey: line.imageStorageKey,
        imageUrl: line.imageUrl,
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
        quantity: line.quantity,
        discount,
        lineTotal: line.unitPrice * line.quantity - discount,
      };
    }),
    lineIssues: evaluation.lineIssues,
    shippingOptions: evaluation.quotes.map((quote) => ({ ...quote })),
    shippingRateId: evaluation.rate?.rateId ?? null,
    coupon: code
      ? {
          code: evaluation.coupon?.code ?? code,
          applied: !!evaluation.coupon,
          issue: evaluation.couponIssue,
        }
      : null,
    totals: {
      subtotal: pricing.subtotal,
      discountTotal: pricing.discountTotal,
      shippingFee: pricing.shippingFee,
      shippingDiscount: pricing.shippingDiscount,
      giftWrapFee: pricing.giftWrapFee,
      total: pricing.total,
      depositRequired: pricing.depositRequired,
    },
    gift: {
      wrap: input.cart.giftWrap,
      message: input.cart.giftMessage,
      hidePrices: input.cart.hidePrices,
    },
    cod: {
      maxOrderWithoutDeposit: evaluation.settings.cod.maxOrderWithoutDeposit,
      depositPercent: evaluation.settings.cod.depositPercent,
    },
  };
}
