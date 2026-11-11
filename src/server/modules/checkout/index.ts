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
  placeOrderInTx,
  type ManualPlaceOrderInput,
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
  type OrderPaymentMethod,
} from './rules';
export { variantLabel } from './labels';

// ---------- Manual orders (wave 2): staff-created orders, same placeOrder rules ----------
export {
  getVariantLines,
  mergeLineRequests,
  searchOrderableVariants,
  type LineRequest,
  type OrderableVariant,
} from './manual-lines';
export {
  placeManualOrder,
  quoteManualOrder,
  type ManualOrderQuote,
  type ManualOrderResult,
  type ManualQuoteLine,
} from './manual-order';
export {
  customerLookupSchema,
  MANUAL_ORDER_LIMITS,
  MANUAL_PAYMENT_OPTIONS,
  manualFollowUp,
  manualOrderSchema,
  manualPaymentMethod,
  manualQuoteSchema,
  mergeManualContact,
  PAYMENT_LINK_PROVIDERS,
  variantSearchSchema,
  type ManualFollowUp,
  type ManualOrderInput,
  type ManualOrderRawInput,
  type ManualPaymentOption,
  type ManualQuoteInput,
  type PaymentLinkProvider,
} from './manual-order-schemas';
