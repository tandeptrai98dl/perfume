'use server';

import 'server-only';

import { isIP } from 'node:net';

import { headers } from 'next/headers';
import { z } from 'zod';

import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  createPaymentSession,
  findOrderByCode,
  onlineProviderSchema,
  type OnlineProvider,
} from '@/server/modules/payment';
import {
  canViewOrder,
  checkoutResultUrl,
  paymentDeps,
  pickOrderCode,
} from '@/server/payment-access';

/**
 * Storefront payment actions (ARCHITECTURE.md §3.4 step 3, ADR-0006): start or retry the
 * online payment of an order from the checkout result page. Access = the order-access check
 * (guest cookie / signed link, or the signed-in owner) instead of a staff permission.
 */

const startSchema = z.object({
  code: z.string().max(40),
  token: z.string().max(64).nullish(),
  provider: onlineProviderSchema,
  locale: z.enum(['vi', 'en']),
});

export type StartPaymentResult =
  | { ok: true; provider: OnlineProvider; checkoutUrl: string | null }
  | {
      ok: false;
      error:
        | 'validation'
        | 'notFound'
        | 'notPayable'
        | 'nothingDue'
        | 'providerUnavailable'
        | 'reservationExpired'
        | 'gatewayError'
        | 'unexpected';
    };

const KNOWN = new Set([
  'notPayable',
  'nothingDue',
  'providerUnavailable',
  'reservationExpired',
  'gatewayError',
]);

async function clientIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? list.get('x-real-ip');
  return forwarded && isIP(forwarded) ? forwarded : null;
}

export async function startPaymentAction(raw: unknown): Promise<StartPaymentResult> {
  const parsed = startSchema.safeParse(raw);
  const code = parsed.success ? pickOrderCode(parsed.data.code) : null;
  if (!parsed.success || !code) return { ok: false, error: 'validation' };

  const db = getDb();
  const order = await findOrderByCode(db, code);
  if (!order || !(await canViewOrder(order, parsed.data.token ?? null))) {
    return { ok: false, error: 'notFound' };
  }
  try {
    const returnUrl = checkoutResultUrl(parsed.data.locale, code);
    const session = await createPaymentSession(await paymentDeps(), {
      orderId: order.id,
      provider: parsed.data.provider,
      ipAddress: await clientIp(),
      returnUrl,
    });
    return { ok: true, provider: session.provider, checkoutUrl: session.checkoutUrl };
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.fieldErrors[0]?.code;
      if (reason && KNOWN.has(reason)) {
        return { ok: false, error: reason as Exclude<StartPaymentResult, { ok: true }>['error'] };
      }
      if (error.code === 'notFound') return { ok: false, error: 'notFound' };
    }
    logger.error('payment.start_failed', { provider: parsed.data.provider, ...errorFields(error) });
    return { ok: false, error: 'unexpected' };
  }
}
