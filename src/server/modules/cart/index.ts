/**
 * Cart module public API (§10.3). Foundation (M2): token helpers and the read API used by
 * checkout. Cart stream: commands (add/update/remove, gift options, coupon), the display view
 * and the sign-in merge.
 */
export { CART_COOKIE, CART_TTL_DAYS, hashCartToken, newCartToken } from './token';
export {
  findActiveCart,
  getCartLines,
  type CartLine,
  type CartRow,
  type VariantType,
} from './queries';

// Cart stream
export {
  addCartItem,
  applyCartCoupon,
  cartExpiry,
  countCartItems,
  getCartView,
  getOrCreateCart,
  mergeGuestCart,
  mergeGuestCartFromCookieHeader,
  readCookie,
  removeCartCoupon,
  removeCartItem,
  setCartItemQuantity,
  setGiftOptions,
  type CommandOutcome,
} from './service';
export {
  COUPON_REJECTIONS,
  GIFT_MESSAGE_MAX_LENGTH,
  lineCap,
  type CartCouponRejection,
  type CouponRejectionDetail,
} from './rules';
export {
  addToCartSchema,
  applyCouponSchema,
  cartLocaleSchema,
  giftOptionsSchema,
  removeCartItemSchema,
  updateCartItemSchema,
} from './schemas';
export { buildCartView, emptyCartView } from './view';
export type {
  CartActionResult,
  CartCouponView,
  CartErrorCode,
  CartLineIssues,
  CartLineView,
  CartOwner,
  CartView,
} from './types';

// ---------- Checkout stream (M2): conversion inside the placeOrder transaction ----------
export { lockCart, markCartConverted } from './conversion';
