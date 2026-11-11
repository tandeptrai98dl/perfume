import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Locale } from '@/i18n/routing';
import { mediaUrl } from '@/lib/media-url';
import type { CheckoutFormOutput } from '@/lib/checkout/form-schema';
import type { Database } from '@/server/db/client';
import { orderAddresses, orderItems, orders } from '@/server/db/schema';
import { enqueue } from '@/server/jobs/queue';
import {
  DomainError,
  isUniqueViolation,
  type FieldIssue,
  type Tx,
} from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { lockCart, markCartConverted } from '@/server/modules/cart';
import { recordConsents, resolveWard, type ConsentRecord } from '@/server/modules/customer';
import { reserveStock } from '@/server/modules/inventory';
import { generateOrderCode, recordOrderEvent, type OrderActor } from '@/server/modules/order';
import { redeemCoupon } from '@/server/modules/promotion';

import { evaluateCheckout } from './evaluate';
import type { LineRequest } from './manual-lines';
import {
  couponRedemptionAmount,
  decideInitialStatus,
  formatAddressLine,
  isHighValueCod,
  reservationExpiry,
  type InitialOrderStatus,
  type OrderPaymentMethod,
} from './rules';

/*
 * Web order creation (ARCHITECTURE.md §3.4 steps 1–2). One transaction:
 *   lock cart → idempotency check → re-read lines + recompute prices (shipping rate and coupon
 *   re-validated) → order + items snapshot + addresses + first event → reserve stock (row
 *   locks) → coupon redemption → cart converted → consents → outbox jobs.
 * Any failure rolls everything back. Lock order is always cart → coupon → inventory rows, so
 * concurrent checkouts serialize without deadlocks.
 *
 * Manual orders (`source = 'admin'`, §3.4 step 7) run the same steps from the variants a staff
 * member picked instead of a cart: same pricing, coupon, shipping and stock rules; no cart and
 * no consents (the customer did not use the storefront); the order records `created_by`. The
 * staff command (`manual-order.ts`) calls `placeOrderInTx` inside its own transaction.
 */

export type PlaceOrderInput = Omit<CheckoutFormOutput, 'locale' | 'checkoutKey'> & {
  source?: 'web';
  cartId: string;
  checkoutKey: string;
  /** Session locale, stored on the order for emails and lookups (§10.7). */
  locale: Locale;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** Manual order placed by staff for a phone/Zalo customer (§3.4 step 7, §11.2). */
export type ManualPlaceOrderInput = {
  source: 'admin';
  /** Staff member creating the order (`orders.created_by`, event actor). */
  staffId: string;
  /** Generated when the form renders; a repeated submit returns the first order. */
  checkoutKey: string;
  items: readonly LineRequest[];
  /** Language of the customer's e-mails and payment pages. */
  locale: Locale;
  /** Registered customer chosen in the lookup, if any. */
  userId: string | null;
  /** Empty when the customer gave no e-mail (no customer e-mails are sent then). */
  email: string;
  phone: string;
  fullName: string;
  address: { provinceCode: string; wardCode: string; street: string };
  shippingRateId: string;
  paymentMethod: OrderPaymentMethod;
  couponCode: string | null;
  /** Staff-only note (`orders.internal_note`). */
  internalNote: string | null;
};

export type PlacedOrder = {
  orderId: string;
  code: string;
  status: InitialOrderStatus;
  paymentMethod: OrderPaymentMethod;
  total: number;
  depositRequired: number;
  locale: Locale;
  /** True when this checkout key had already created the order (double submit). */
  duplicate: boolean;
};

export type PlaceOrderDeps = {
  db: Database;
  boss: PgBoss;
  now?: () => Date;
  /** Test seam for code clashes. */
  generateCode?: () => string;
};

const MAX_CODE_ATTEMPTS = 5;
const USER_AGENT_MAX = 500;

type Executor = Pick<Database, 'select'>;

/** The order a checkout key already created, if any (double submit, back button). */
export async function findOrderByCheckoutKey(
  db: Executor,
  checkoutKey: string,
): Promise<PlacedOrder | null> {
  const [row] = await db
    .select({
      orderId: orders.id,
      code: orders.code,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      depositRequired: orders.depositRequired,
      locale: orders.locale,
    })
    .from(orders)
    .where(eq(orders.checkoutKey, checkoutKey))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    status: row.status as InitialOrderStatus,
    paymentMethod: row.paymentMethod as PlacedOrder['paymentMethod'],
    duplicate: true,
  };
}

/** Web orders placed from one IP in the last `windowMs` (rate limit 5/min/IP, §12). */
export async function countRecentOrdersByIp(
  db: Executor,
  ip: string,
  windowMs = 60_000,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(orders)
    .where(
      and(
        sql`${orders.ipAddress} = ${ip}::inet`,
        gt(orders.placedAt, new Date(now.getTime() - windowMs)),
      ),
    );
  return row?.n ?? 0;
}

function invalid(issues: FieldIssue[]): never {
  throw new DomainError('invalid', issues);
}

export async function placeOrder(
  deps: PlaceOrderDeps,
  input: PlaceOrderInput | ManualPlaceOrderInput,
): Promise<PlacedOrder> {
  try {
    return await deps.db.transaction((tx) => placeOrderInTx(tx, deps, input));
  } catch (error) {
    // Defence in depth: a concurrent submit with the same key that did not share the cart lock.
    if (isUniqueViolation(error, 'orders_checkoutKey_unique')) {
      const existing = await findOrderByCheckoutKey(deps.db, input.checkoutKey);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Same as `placeOrder`, inside the caller's transaction (manual orders add steps after it). */
export async function placeOrderInTx(
  tx: Tx,
  deps: Omit<PlaceOrderDeps, 'db'>,
  input: PlaceOrderInput | ManualPlaceOrderInput,
): Promise<PlacedOrder> {
  const now = deps.now?.() ?? new Date();
  const manual = input.source === 'admin';
  const actor: OrderActor = manual
    ? { type: 'staff', id: input.staffId }
    : { type: 'customer', id: input.userId };

  let cart: Awaited<ReturnType<typeof lockCart>> = null;
  if (manual) {
    // No cart row to lock: serialize double submits of the same form on its key instead.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`checkout-key:${input.checkoutKey}`}))`,
    );
    const existing = await findOrderByCheckoutKey(tx, input.checkoutKey);
    if (existing) return existing;
  } else {
    cart = await lockCart(tx, input.cartId);
    // A double submit waited on the cart lock above; the first one has committed by now.
    const existing = await findOrderByCheckoutKey(tx, input.checkoutKey);
    if (existing) return existing;
    if (!cart || cart.status !== 'active') {
      invalid([{ path: 'cart', code: 'cartUnavailable' }]);
    }
    if (cart.userId && cart.userId !== input.userId) {
      invalid([{ path: 'cart', code: 'cartUnavailable' }]);
    }
  }

  // Address: the ward must exist and belong to the province (2-level units).
  const shipping = await resolveWard(tx, input.address);
  if (!shipping.ok) invalid([{ path: `address.${shipping.field}`, code: shipping.code }]);
  const vatRequest = manual ? null : input.vatInvoice;
  const billing = vatRequest ? await resolveWard(tx, vatRequest.address) : null;
  if (billing && !billing.ok) {
    invalid([{ path: `vatInvoice.address.${billing.field}`, code: billing.code }]);
  }

  const evaluation = await evaluateCheckout(tx, {
    ...(manual ? { items: input.items } : { cart: cart! }),
    locale: input.locale,
    provinceCode: input.address.provinceCode,
    shippingRateId: input.shippingRateId,
    paymentMethod: input.paymentMethod,
    couponCode: input.couponCode,
    customer: {
      phone: input.phone,
      email: input.email || undefined,
      userId: input.userId,
    },
    lockCoupon: true,
    now,
  });
  const { lines, pricing, settings, coupon } = evaluation;
  if (lines.length === 0) invalid([{ path: manual ? 'items' : 'cart', code: 'cartEmpty' }]);
  if (manual && lines.length !== new Set(input.items.map((i) => i.variantId)).size) {
    invalid([{ path: 'items', code: 'itemUnavailable' }]);
  }
  if (evaluation.lineIssues.length > 0) invalid(evaluation.lineIssues);
  const issues: FieldIssue[] = [];
  if (!evaluation.rate) issues.push({ path: 'shippingRateId', code: 'shippingRateUnavailable' });
  if (evaluation.couponIssue) issues.push({ path: 'couponCode', code: evaluation.couponIssue });
  if (issues.length > 0) invalid(issues);
  if (!manual && input.expectedTotal !== undefined && input.expectedTotal !== pricing.total) {
    throw new DomainError('conflict', [{ path: 'total', code: 'priceChanged' }]);
  }

  const status = decideInitialStatus(input.paymentMethod, pricing.depositRequired);
  const orderId = newId();
  const vatInvoice =
    vatRequest && billing?.ok
      ? {
          companyName: vatRequest.companyName,
          taxCode: vatRequest.taxCode,
          email: vatRequest.email,
          address: formatAddressLine({
            street: vatRequest.address.street,
            wardName: billing.ward.name,
            provinceName: billing.province.name,
          }),
        }
      : null;

  const values = {
    id: orderId,
    userId: input.userId,
    email: input.email,
    phone: input.phone,
    customerName: input.fullName,
    locale: input.locale,
    source: manual ? ('admin' as const) : ('web' as const),
    createdBy: manual ? input.staffId : null,
    status,
    paymentMethod: input.paymentMethod,
    subtotal: pricing.subtotal,
    discountTotal: pricing.discountTotal,
    shippingFee: pricing.shippingFee ?? 0,
    giftWrapFee: pricing.giftWrapFee,
    total: pricing.total,
    depositRequired: pricing.depositRequired,
    couponCode: coupon?.code ?? null,
    giftWrap: cart?.giftWrap ?? false,
    giftMessage: cart?.giftMessage ?? null,
    hidePrices: cart?.hidePrices ?? false,
    customerNote: manual ? null : input.customerNote,
    internalNote: manual ? input.internalNote : null,
    vatInvoice,
    checkoutKey: input.checkoutKey,
    shippingRateId: evaluation.rate!.rateId,
    // Fraud signals of storefront orders only; the staff IP goes to the audit log.
    ipAddress: manual ? null : input.ip,
    userAgent: manual ? null : (input.userAgent?.slice(0, USER_AGENT_MAX) ?? null),
    placedAt: now,
  };

  // Codes are short and random: retry on the rare clash inside a savepoint.
  let code = '';
  for (let attempt = 1; ; attempt += 1) {
    code = (deps.generateCode ?? (() => generateOrderCode(now)))();
    try {
      await tx.transaction(async (sp) => {
        await sp.insert(orders).values({ ...values, code });
      });
      break;
    } catch (error) {
      if (isUniqueViolation(error, 'orders_code_unique') && attempt < MAX_CODE_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  await tx.insert(orderItems).values(
    lines.map((line) => {
      const discount = pricing.lineDiscounts[line.variantId] ?? 0;
      return {
        orderId,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantLabel: line.variantLabel,
        sku: line.sku,
        imageUrl: line.imageStorageKey
          ? mediaUrl(line.imageStorageKey, line.imageUrl)
          : line.imageUrl,
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
        quantity: line.quantity,
        discountAllocated: discount,
        lineTotal: line.unitPrice * line.quantity - discount,
      };
    }),
  );

  const addressRows: (typeof orderAddresses.$inferInsert)[] = [
    {
      orderId,
      type: 'shipping',
      fullName: input.fullName,
      phone: input.phone,
      provinceCode: shipping.province.code,
      provinceName: shipping.province.name,
      wardCode: shipping.ward.code,
      wardName: shipping.ward.name,
      street: input.address.street,
    },
  ];
  if (vatRequest && billing?.ok) {
    addressRows.push({
      orderId,
      type: 'billing',
      fullName: vatRequest.companyName,
      phone: input.phone,
      provinceCode: billing.province.code,
      provinceName: billing.province.name,
      wardCode: billing.ward.code,
      wardName: billing.ward.name,
      street: vatRequest.address.street,
    });
  }
  await tx.insert(orderAddresses).values(addressRows);

  await recordOrderEvent(tx, {
    orderId,
    type: 'placed',
    toStatus: status,
    actor,
    metadata: {
      source: manual ? 'admin' : 'web',
      paymentMethod: input.paymentMethod,
      total: pricing.total,
      depositRequired: pricing.depositRequired,
      couponCode: coupon?.code ?? null,
    },
  });

  await reserveLines(tx, {
    orderId,
    lines,
    expiresAt: reservationExpiry(status, settings, now, input.paymentMethod),
  });

  if (coupon) {
    await redeemCoupon(tx, {
      couponId: coupon.id,
      orderId,
      userId: input.userId,
      phone: input.phone,
      email: input.email,
      amount: couponRedemptionAmount(coupon.type, pricing),
    });
  }

  if (!manual) {
    await markCartConverted(tx, cart!.id);

    const consentRecords: ConsentRecord[] = [
      { purpose: 'terms', granted: input.consents.terms },
      { purpose: 'privacy', granted: input.consents.privacy },
    ];
    if (input.consents.marketing)
      consentRecords.push({ purpose: 'marketing_email', granted: true });
    await recordConsents(tx, {
      records: consentRecords,
      userId: input.userId,
      email: input.email,
      phone: input.phone,
      locale: input.locale,
      source: 'checkout',
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
    });
  }

  await enqueue(deps.boss, tx, 'order.placed', { orderId });
  if (isHighValueCod(input.paymentMethod, pricing.total, settings)) {
    // No PII: staff open the order from the alert.
    await enqueue(deps.boss, tx, 'staff.alert', {
      kind: 'high_value_cod',
      orderId,
      message: `${code}: COD ${pricing.total} VND, deposit ${pricing.depositRequired} VND`,
    });
  }

  return {
    orderId,
    code,
    status,
    paymentMethod: input.paymentMethod,
    total: pricing.total,
    depositRequired: pricing.depositRequired,
    locale: input.locale,
    duplicate: false,
  };
}

/** Maps the inventory module's per-variant shortage to the checkout's `items.<variantId>`. */
async function reserveLines(
  tx: Tx,
  input: { orderId: string; lines: { variantId: string; quantity: number }[]; expiresAt: Date },
): Promise<void> {
  try {
    await reserveStock(tx, {
      orderId: input.orderId,
      lines: input.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      expiresAt: input.expiresAt,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'insufficientStock') {
      throw new DomainError(
        'insufficientStock',
        error.fieldErrors.map((issue) => ({
          path: `items.${issue.path}`,
          code: 'itemInsufficientStock',
        })),
      );
    }
    throw error;
  }
}
