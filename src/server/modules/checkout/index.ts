/**
 * Checkout module public API (ARCHITECTURE.md §3.3, §3.4): pricing, the live order summary and
 * web order creation. Shared with the worker: no `server-only`, no Next.js APIs (ADR-0023).
 */
export {
  allocate,
  codDeposit,
  priceCart,
  type CouponRejection,
  type CouponScope,
  type CouponType,
  type PricingCoupon,
  type PricingInput,
  type PricingLine,
  type PricingResult,
  type PricingShippingRate,
} from './pricing';
export {
  couponIssueCode,
  evaluateCheckout,
  type CheckoutEvaluation,
  type CouponIssueCode,
  type EvaluatedLine,
} from './evaluate';
export {
  quoteCheckout,
  type CheckoutQuote,
  type CheckoutQuoteLine,
  type CheckoutQuoteShipping,
} from './quote';
export {
  countRecentOrdersByIp,
  findOrderByCheckoutKey,
  placeOrder,
  type PlacedOrder,
  type PlaceOrderDeps,
  type PlaceOrderInput,
} from './place-order';
export {
  checkCartLines,
  decideInitialStatus,
  isHighValueCod,
  isOnlineMethod,
  reservationExpiry,
  type InitialOrderStatus,
} from './rules';
export { variantLabel } from './labels';
