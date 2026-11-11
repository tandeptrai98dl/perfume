import 'server-only';

import { serverEnv } from '@/lib/env';
import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import { getSession } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getPaymentGateways } from '@/server/integrations/payments';
import { getProducer } from '@/server/jobs/producer';
import { ORDER_CODE_PATTERN } from '@/server/modules/order';
import type { PaymentDeps } from '@/server/modules/payment';

import { hasOrderAccess, orderAccessToken } from './order-access';

/**
 * Next-only glue for the checkout result page, its status endpoint and the retry action:
 * who may see an order (guest cookie / signed link, or the signed-in owner) and the payment
 * module dependencies of this process.
 */

/** Query values can repeat (payOS appends its own `code=00` to the return URL). */
export function pickOrderCode(value: string | string[] | null | undefined): string | null {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.find((candidate) => ORDER_CODE_PATTERN.test(candidate)) ?? null;
}

export function firstValue(value: string | string[] | null | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** True when this visitor placed the order, holds a signed link, or owns it while signed in. */
export async function canViewOrder(
  order: { code: string; userId: string | null },
  token: string | null,
): Promise<boolean> {
  if (await hasOrderAccess(order.code, token)) return true;
  if (!order.userId) return false;
  const session = await getSession();
  return session?.user.id === order.userId;
}

export async function paymentDeps(): Promise<PaymentDeps> {
  return { db: getDb(), boss: await getProducer(), gateways: getPaymentGateways() };
}

/**
 * Absolute result page URL with the signed access token: the gateway return URL, and what
 * `placeOrder` / emails can link to (`/thanh-toan/ket-qua?code=…&t=…`).
 */
export function checkoutResultUrl(locale: 'vi' | 'en', code: string): string {
  const query = new URLSearchParams({ code, t: orderAccessToken(code) });
  return absoluteUrl(
    serverEnv().APP_URL,
    `${localizedPath(locale, '/checkout/result')}?${query.toString()}`,
  );
}
