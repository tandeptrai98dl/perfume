'use server';

import 'server-only';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  checkoutFormSchema,
  checkoutQuoteSchema,
  type CheckoutFormOutput,
} from '@/lib/checkout/form-schema';
import { allowCouponAttempt } from '@/server/cart-session';
import { getCheckoutCart, requestContext } from '@/server/checkout-request';
import { getDb } from '@/server/db/client';
import { getProducer } from '@/server/jobs/producer';
import { DomainError, type DomainErrorCode, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  findOrderByCheckoutKey,
  isCouponAttempt,
  placeOrder,
  quoteCheckout,
  withCouponRateLimited,
  type CheckoutQuote,
  type PlacedOrder,
} from '@/server/modules/checkout';
import { listWards, type AdminUnit } from '@/server/modules/customer';
import { createPaymentSession } from '@/server/modules/payment';
import { grantOrderAccess } from '@/server/order-access';
import { checkoutResultUrl, paymentDeps } from '@/server/payment-access';
import { guardRequest } from '@/server/request-guard';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile';

/*
 * Checkout Server Actions (§10.4). The storefront is public, so there is no permission check:
 * each action validates its input with Zod first, resolves the cart from the session/cookie
 * (never from the client) and calls the checkout module. Failures come back as typed results
 * with field paths matching the form; nothing user-facing is thrown.
 */

export type CheckoutActionError =
  | DomainErrorCode
  | 'validation'
  | 'cartUnavailable'
  | 'rateLimited'
  | 'captchaFailed'
  | 'unexpected';

export type CheckoutFailure = { ok: false; error: CheckoutActionError; fieldErrors: FieldIssue[] };

/** VNPay orders go straight to the gateway (§10.4); the client navigates there. */
export type PlaceOrderRedirect = { ok: true; gatewayUrl: string };

const CODE_PATTERN = /^[a-zA-Z]+$/;

function zodIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
  }));
}

function resultPath(order: Pick<PlacedOrder, 'code'>, locale: Locale): string {
  return `${getPathname({ locale, href: '/checkout/result' })}?code=${encodeURIComponent(order.code)}`;
}

/**
 * VNPay (§10.4 "redirect to the gateway"): opens the first payment session right away so the
 * buyer lands on VNPay, not on an intermediate page. Null on any failure: the result page then
 * shows the VNPay button / retry panel, which opens a session itself.
 */
async function vnpayGatewayUrl(
  order: Pick<PlacedOrder, 'orderId' | 'code' | 'locale' | 'paymentMethod' | 'status'>,
  ip: string | null,
): Promise<string | null> {
  if (order.paymentMethod !== 'vnpay' || order.status !== 'pending') return null;
  try {
    const session = await createPaymentSession(await paymentDeps(), {
      orderId: order.orderId,
      provider: 'vnpay',
      ipAddress: ip,
      returnUrl: checkoutResultUrl(order.locale, order.code),
    });
    return session.checkoutUrl;
  } catch (error) {
    logger.warn('checkout.vnpay_session_failed', errorFields(error));
    return null;
  }
}

/**
 * Places the order and redirects to the localized result page (`/thanh-toan/ket-qua?code=…`,
 * `/en/checkout/result?code=…`), which shows the COD confirmation or the payment step. VNPay
 * orders instead return the gateway URL (an external page: the client navigates there).
 */
export async function placeOrderAction(
  raw: unknown,
  turnstileToken?: unknown,
): Promise<CheckoutFailure | PlaceOrderRedirect> {
  const parsed = checkoutFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: zodIssues(parsed.error) };
  }
  const form: CheckoutFormOutput = parsed.data;
  const db = getDb();

  // A repeated submit (double click, retry after a network error) returns the first order.
  const existing = await findOrderByCheckoutKey(db, form.checkoutKey);
  const context = await requestContext();
  if (existing) {
    await grantOrderAccess(existing.code);
    const gatewayUrl = await vnpayGatewayUrl(existing, context.ip);
    if (gatewayUrl) return { ok: true, gatewayUrl };
    redirect(resultPath(existing, existing.locale));
  }

  // Place order 5/min/IP (§12, shared limiter) + Turnstile when configured. A repeated submit
  // above returns the first order without a new token.
  const guard = await guardRequest({
    scope: 'placeOrder',
    turnstile: { token: turnstileToken, action: TURNSTILE_ACTIONS.placeOrder },
  });
  if (!guard.ok) return { ok: false, error: guard.error, fieldErrors: [] };

  const { cart, shopper } = await getCheckoutCart();
  if (!cart) {
    return {
      ok: false,
      error: 'cartUnavailable',
      fieldErrors: [{ path: 'cart', code: 'cartUnavailable' }],
    };
  }

  let order: PlacedOrder;
  try {
    const { locale, checkoutKey, ...fields } = form;
    order = await placeOrder(
      { db, boss: await getProducer() },
      {
        ...fields,
        cartId: cart.id,
        checkoutKey,
        locale,
        userId: shopper.userId,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.code, fieldErrors: error.fieldErrors };
    }
    logger.error('checkout.place_order_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }

  if (!order.duplicate) {
    logger.info('checkout.order_placed', {
      orderId: order.orderId,
      paymentMethod: order.paymentMethod,
      status: order.status,
    });
  }
  await grantOrderAccess(order.code);
  const gatewayUrl = await vnpayGatewayUrl(order, context.ip);
  if (gatewayUrl) return { ok: true, gatewayUrl };
  redirect(resultPath(order, order.locale));
}

export type QuoteResult = { ok: true; quote: CheckoutQuote } | CheckoutFailure;

/** Live order summary: shipping options for the province, coupon status and totals. */
export async function quoteCheckoutAction(raw: unknown): Promise<QuoteResult> {
  const parsed = checkoutQuoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: zodIssues(parsed.error) };
  }
  const input = parsed.data;
  try {
    const { cart, shopper } = await getCheckoutCart();
    if (!cart) return { ok: false, error: 'cartUnavailable', fieldErrors: [] };
    // Same per-cart coupon limit as the cart's "Apply" (§12): no brute-force oracle here.
    const couponLimited =
      isCouponAttempt(input.couponCode, cart.couponCode) && !(await allowCouponAttempt(cart.id));
    const quote = await quoteCheckout(getDb(), {
      cart,
      locale: input.locale,
      provinceCode: input.provinceCode || null,
      shippingRateId: input.shippingRateId || null,
      paymentMethod: input.paymentMethod || null,
      couponCode: couponLimited ? null : input.couponCode || null,
      customer: {
        phone: input.phone || undefined,
        email: input.email || undefined,
        userId: shopper.userId,
      },
    });
    return {
      ok: true,
      quote:
        couponLimited && input.couponCode ? withCouponRateLimited(quote, input.couponCode) : quote,
    };
  } catch (error) {
    logger.error('checkout.quote_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}

const wardsInput = z.object({
  provinceCode: z
    .string()
    .trim()
    .regex(/^\d{1,10}$/),
});

export type WardsResult = { ok: true; wards: AdminUnit[] } | CheckoutFailure;

/** Wards of a province for the address Combobox (read-only, public reference data). */
export async function listWardsAction(raw: unknown): Promise<WardsResult> {
  const parsed = wardsInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: zodIssues(parsed.error) };
  }
  try {
    return { ok: true, wards: await listWards(getDb(), parsed.data.provinceCode) };
  } catch (error) {
    logger.error('checkout.wards_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}
