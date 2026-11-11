import type { FieldIssue } from '@/server/lib/command-context';
import {
  codDeposit,
  priceCart,
  type CouponRejection,
  type PricingCoupon,
  type PricingLine,
  type PricingShippingRate,
} from '@/server/modules/checkout/pricing';

import { RESERVING_STATUSES, type OrderStatus } from './state-machine';

/*
 * Pure part of an admin order edit (§3.4 step 8, ADR-0005/0006): which orders can be edited,
 * the new lines (prices: snapshot for kept lines, catalogue for new ones), stock deltas, the
 * before/after diff for `order_events`, and the totals recomputed with `priceCart`. No I/O.
 */

/** Before the parcel leaves: unpaid/unconfirmed (stock reserved) or confirmed/packing (deducted). */
export const EDITABLE_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'processing',
] as const satisfies readonly OrderStatus[];

export function canEditOrder(status: OrderStatus): boolean {
  return (EDITABLE_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Reserving statuses adjust reservations; later ones adjust real (committed) stock. */
export function stockModeFor(status: OrderStatus): 'reserved' | 'committed' {
  return RESERVING_STATUSES.includes(status) ? 'reserved' : 'committed';
}

/** A line of the order as it is (snapshot from `order_items`). */
export type CurrentLine = {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
};

/** Catalogue facts about a variant (current price, stock, whether it is still sold). */
export type CatalogVariant = {
  variantId: string;
  productId: string;
  brandId: string;
  categoryIds: readonly string[];
  productName: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  weightG: number;
  available: number;
  /** Active, published, not a decant (ADR-0015). */
  purchasable: boolean;
};

export type PlannedLine = PricingLine &
  Omit<CurrentLine, 'unitPrice' | 'compareAtPrice' | 'quantity'> & { isNew: boolean };

export type RequestedLine = { variantId: string; quantity: number };

/**
 * New lines of the order. Kept lines keep their snapshot price (what the customer agreed to);
 * new variants use the current catalogue price. Increases need stock and a variant that is
 * still sold; lines above the per-line cap are refused. Issues use `items.<index>.*` paths.
 */
export function buildEditLines(
  current: readonly CurrentLine[],
  requested: readonly RequestedLine[],
  catalog: ReadonlyMap<string, CatalogVariant>,
  maxQuantityPerLine: number,
): { lines: PlannedLine[]; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const lines: PlannedLine[] = [];
  requested.forEach((request, index) => {
    const path = `items.${index}.quantity`;
    const existing = current.find((line) => line.variantId === request.variantId);
    const variant = catalog.get(request.variantId);
    if (!variant) {
      issues.push({ path: `items.${index}.variantId`, code: 'notFound' });
      return;
    }
    const before = existing?.quantity ?? 0;
    const increase = request.quantity - before;
    if (increase > 0) {
      if (!variant.purchasable) issues.push({ path, code: 'itemUnavailable' });
      else if (request.quantity > maxQuantityPerLine) {
        issues.push({ path, code: 'itemQuantityLimit' });
      } else if (variant.available < increase) {
        issues.push({ path, code: 'itemInsufficientStock' });
      }
    }
    lines.push({
      variantId: variant.variantId,
      productId: variant.productId,
      brandId: variant.brandId,
      categoryIds: variant.categoryIds,
      weightG: variant.weightG,
      quantity: request.quantity,
      productName: existing?.productName ?? variant.productName,
      variantLabel: existing?.variantLabel ?? variant.variantLabel,
      sku: existing?.sku ?? variant.sku,
      imageUrl: existing ? existing.imageUrl : variant.imageUrl,
      unitPrice: existing ? existing.unitPrice : variant.price,
      compareAtPrice: existing ? existing.compareAtPrice : variant.compareAtPrice,
      isNew: !existing,
    });
  });
  return { lines, issues };
}

/** Stock delta per variant (removed lines give back their whole quantity), by variant id. */
export function stockChanges(
  current: readonly Pick<CurrentLine, 'variantId' | 'quantity'>[],
  requested: readonly RequestedLine[],
): { variantId: string; delta: number }[] {
  const deltas = new Map<string, number>();
  for (const line of current) deltas.set(line.variantId, -line.quantity);
  for (const line of requested) {
    deltas.set(line.variantId, (deltas.get(line.variantId) ?? 0) + line.quantity);
  }
  return [...deltas]
    .filter(([, delta]) => delta !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variantId, delta]) => ({ variantId, delta }));
}

export type LineDiff = {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  /** null = line added. */
  from: number | null;
  /** null = line removed. */
  to: number | null;
};

export function diffLines(
  current: readonly CurrentLine[],
  next: readonly Pick<
    PlannedLine,
    'variantId' | 'sku' | 'productName' | 'variantLabel' | 'quantity'
  >[],
): LineDiff[] {
  const out: LineDiff[] = [];
  for (const line of current) {
    const after = next.find((candidate) => candidate.variantId === line.variantId);
    if (!after || after.quantity !== line.quantity) {
      out.push({
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        variantLabel: line.variantLabel,
        from: line.quantity,
        to: after?.quantity ?? null,
      });
    }
  }
  for (const line of next) {
    if (!current.some((candidate) => candidate.variantId === line.variantId)) {
      out.push({
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        variantLabel: line.variantLabel,
        from: null,
        to: line.quantity,
      });
    }
  }
  return out;
}

export type EditAddress = {
  fullName: string;
  phone: string;
  provinceCode: string;
  provinceName: string;
  wardCode: string;
  wardName: string;
  street: string;
};

export const ADDRESS_FIELDS = [
  'fullName',
  'phone',
  'provinceCode',
  'provinceName',
  'wardCode',
  'wardName',
  'street',
] as const satisfies readonly (keyof EditAddress)[];

export type Change<T> = { from: T; to: T };

export function diffAddress(
  before: EditAddress | null,
  after: EditAddress,
): Partial<Record<keyof EditAddress, Change<string | null>>> {
  const out: Partial<Record<keyof EditAddress, Change<string | null>>> = {};
  for (const field of ADDRESS_FIELDS) {
    const from = before?.[field] ?? null;
    if (from !== after[field]) out[field] = { from, to: after[field] };
  }
  return out;
}

export type EditTotals = {
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  /** Discount per variant (sums to `discountTotal`). */
  lineDiscounts: Record<string, number>;
  /** Value granted by the coupon (`coupon_redemptions.amount`). */
  couponAmount: number;
};

export type RepriceInput = {
  lines: readonly PricingLine[];
  coupon: PricingCoupon | null;
  /** Rate for the (new) province and weight; null when none is offered. */
  shippingRate: PricingShippingRate | null;
  /** Manager override of the shipping fee (wins over the rate and free-shipping rules). */
  shippingFeeOverride: number | null;
  giftWrap: { enabled: boolean; fee: number };
  cod: { maxOrderWithoutDeposit: number; depositPercent: number };
  paymentMethod: string;
};

export type RepriceResult = {
  totals: EditTotals;
  /** The order's coupon no longer applies to the new lines (it is dropped). */
  couponDropped: { code: string; reason: CouponRejection } | null;
};

/**
 * Totals of the edited order with `priceCart` (integer VND). The coupon is kept while its
 * terms still hold for the new lines; otherwise the order is priced without it. A shipping
 * fee override replaces the computed fee after the coupon/free-shipping rules.
 */
export function repriceOrder(input: RepriceInput): RepriceResult {
  const cod = input.paymentMethod === 'cod';
  const price = (coupon: PricingCoupon | null) =>
    priceCart({
      lines: input.lines,
      coupon,
      shippingRate: input.shippingRate ?? { fee: 0, freeOverSubtotal: null },
      giftWrap: input.giftWrap,
      cod: input.cod,
      paymentMethod: cod ? 'cod' : 'online',
    });
  let pricing = price(input.coupon);
  let couponDropped: RepriceResult['couponDropped'] = null;
  if (pricing.coupon && !pricing.coupon.applied) {
    couponDropped = {
      code: pricing.coupon.code,
      reason: pricing.coupon.rejection ?? 'no_eligible_items',
    };
    pricing = price(null);
  }
  const applied = pricing.coupon?.applied ? input.coupon : null;
  const couponAmount = applied
    ? applied.type === 'free_shipping'
      ? pricing.shippingDiscount
      : pricing.discountTotal
    : 0;

  let shippingFee = pricing.shippingFee ?? 0;
  let total = pricing.total;
  let depositRequired = pricing.depositRequired;
  if (input.shippingFeeOverride !== null) {
    total = total - shippingFee + input.shippingFeeOverride;
    shippingFee = input.shippingFeeOverride;
    depositRequired = cod ? codDeposit(total, input.cod) : 0;
  }
  return {
    totals: {
      subtotal: pricing.subtotal,
      discountTotal: pricing.discountTotal,
      shippingFee,
      giftWrapFee: pricing.giftWrapFee,
      total,
      depositRequired,
      lineDiscounts: pricing.lineDiscounts,
      couponAmount,
    },
    couponDropped,
  };
}

/**
 * Deposit after the edit (ADR-0016). Before confirmation the recomputed deposit applies; once
 * confirmed the deposit was settled, so it may shrink with the total but never asks for more
 * (the carrier collects the balance).
 */
export function nextDepositRequired(
  status: OrderStatus,
  recomputed: number,
  current: number,
): number {
  return stockModeFor(status) === 'reserved' ? recomputed : Math.min(recomputed, current);
}

/** Totals that changed, for the `order_events` diff. */
export function diffTotals(
  before: Omit<EditTotals, 'lineDiscounts' | 'couponAmount'>,
  after: Omit<EditTotals, 'lineDiscounts' | 'couponAmount'>,
): Partial<Record<keyof typeof before, Change<number>>> {
  const out: Partial<Record<keyof typeof before, Change<number>>> = {};
  for (const key of [
    'subtotal',
    'discountTotal',
    'shippingFee',
    'giftWrapFee',
    'total',
    'depositRequired',
  ] as const) {
    if (before[key] !== after[key]) out[key] = { from: before[key], to: after[key] };
  }
  return out;
}
