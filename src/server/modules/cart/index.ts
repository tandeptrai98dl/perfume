/**
 * Cart module public API. Foundation (M2): token helpers and the read API used by checkout.
 * The cart stream adds commands (add/update/remove, merge on sign-in, gift options, coupon).
 */
export { CART_COOKIE, CART_TTL_DAYS, hashCartToken, newCartToken } from './token';
export { findActiveCart, getCartLines, type CartLine, type CartRow } from './queries';

// ---------- Checkout stream (M2): conversion inside the placeOrder transaction ----------
export { lockCart, markCartConverted } from './conversion';
