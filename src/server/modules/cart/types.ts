import type { VariantType } from './queries';
import type { CouponRejectionDetail } from './rules';

/** Who owns the cart of a request: a signed-in member, a guest cookie token, or nobody yet. */
export type CartOwner = { userId?: string | null; token?: string | null };

export type CartLineIssues = {
  /** Current unit price differs from the price when the line was added. */
  priceChanged: boolean;
  /** Product or variant is no longer sold, or it is out of stock. */
  unavailable: boolean;
  /** Quantity is higher than what can be bought now (stock or per-line limit). */
  overStock: boolean;
};

/** One cart line as shown in the mini-cart and the cart page. Serializable (Server Actions). */
export type CartLineView = {
  itemId: string;
  variantId: string;
  productId: string;
  sku: string;
  sizeMl: number;
  variantType: VariantType;
  productName: string;
  productSlug: string | null;
  brandName: string;
  imageStorageKey: string | null;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  priceWhenAdded: number;
  quantity: number;
  /** unitPrice × quantity before discounts (VND). */
  lineTotal: number;
  /** Highest quantity allowed now: min(available, per-line limit). 0 when not purchasable. */
  maxQuantity: number;
  available: number;
  issues: CartLineIssues;
};

export type CartCouponView = {
  code: string;
  applied: boolean;
  /** Present when the stored code no longer applies (e.g. subtotal fell below the minimum). */
  rejection?: CouponRejectionDetail;
  /** Applied free-shipping coupons discount shipping at checkout, not the merchandise. */
  freeShipping: boolean;
};

export type CartView = {
  cartId: string | null;
  /** Sum of quantities (header badge). */
  itemCount: number;
  lines: CartLineView[];
  /** Purchasable lines only (VND). */
  subtotal: number;
  discountTotal: number;
  giftWrapFee: number;
  /** subtotal − discount + gift wrap; shipping is calculated at checkout. */
  total: number;
  coupon: CartCouponView | null;
  gift: { wrap: boolean; message: string | null; hidePrices: boolean; fee: number };
  freeShipping: { threshold: number; remaining: number; percent: number; unlocked: boolean } | null;
  maxQuantityPerLine: number;
  /** True when every line can be bought as it is (no unavailable or over-stock line). */
  canCheckout: boolean;
};

export type CartErrorCode =
  | 'validation'
  | 'notFound'
  | 'unavailable'
  | 'out_of_stock'
  | 'limit_reached'
  | 'coupon'
  | 'rate_limited'
  | 'unexpected';

export type CartActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: CartErrorCode;
      /** Cap for `limit_reached`. */
      max?: number;
      /** Reason for `coupon`. */
      coupon?: CouponRejectionDetail;
    };
