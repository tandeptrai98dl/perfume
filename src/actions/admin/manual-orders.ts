'use server';

import 'server-only';

import { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  customerLookupSchema,
  manualOrderSchema,
  manualQuoteSchema,
  placeManualOrder,
  quoteManualOrder,
  searchOrderableVariants,
  variantSearchSchema,
  type ManualOrderQuote,
  type ManualOrderResult,
  type OrderableVariant,
  type PaymentLinkProvider,
} from '@/server/modules/checkout';
import {
  listWards,
  lookupCustomers,
  type AdminUnit,
  type CustomerMatch,
} from '@/server/modules/customer';
import { createPaymentSession } from '@/server/modules/payment';
import { checkoutResultUrl, paymentDeps } from '@/server/payment-access';

import { runAdminAction, zodFieldErrors, type ActionResult } from './run';

/*
 * Manual orders (§5.2 `/admin/orders/new`, §11.2): `orders.createManual` (Owner, Manager,
 * Staff). Confirming a bank transfer while creating the order additionally needs
 * `payments.confirmBankTransfer` (checked by the command). The read actions behind the form
 * (customer lookup, variant search, live summary, wards) are validated and permission-checked
 * like the write.
 */

const PERMISSION = 'orders.createManual' as const;

async function authorized(): Promise<boolean> {
  try {
    await requirePermission(PERMISSION);
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

async function readAction<S extends z.ZodType, T>(
  schema: S,
  raw: unknown,
  read: (input: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error) };
  }
  if (!(await authorized())) return { ok: false, error: 'unauthorized', fieldErrors: [] };
  try {
    return { ok: true, data: await read(parsed.data) };
  } catch (error) {
    logger.error('admin.manual_order.read_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}

/** Exact phone / e-mail match; contact details come back masked. */
export async function lookupCustomersAction(raw: unknown) {
  return readAction(customerLookupSchema, raw, (query): Promise<CustomerMatch[]> =>
    lookupCustomers(getDb(), query),
  );
}

export async function searchOrderVariantsAction(raw: unknown) {
  return readAction(variantSearchSchema, raw, ({ q }): Promise<OrderableVariant[]> =>
    searchOrderableVariants(getDb(), { q, limit: 10 }),
  );
}

export async function quoteManualOrderAction(raw: unknown) {
  return readAction(manualQuoteSchema, raw, (input): Promise<ManualOrderQuote> =>
    quoteManualOrder(getDb(), input),
  );
}

export async function listManualOrderWardsAction(raw: unknown) {
  return readAction(
    z.object({
      provinceCode: z
        .string()
        .trim()
        .regex(/^\d{1,10}$/),
    }),
    raw,
    ({ provinceCode }): Promise<AdminUnit[]> => listWards(getDb(), provinceCode),
  );
}

export type ManualOrderPaymentLink = {
  provider: PaymentLinkProvider;
  /** Result page with the signed access token: QR / VNPay button, retry until it expires. */
  url: string;
  /** Direct gateway page of the session opened now (null when it could not be opened). */
  gatewayUrl: string | null;
  expiresAt: string | null;
  /** Error code when the first session could not be opened (the link still works). */
  error: string | null;
};

export type PlaceManualOrderData = ManualOrderResult & { link: ManualOrderPaymentLink | null };

/**
 * Creates the order (one transaction), then — outside it — opens the first payment session
 * when the customer pays online (full amount or COD deposit), so staff can send the link.
 */
export async function placeManualOrderAction(
  raw: unknown,
): Promise<ActionResult<PlaceManualOrderData>> {
  return runAdminAction(
    manualOrderSchema,
    raw,
    PERMISSION,
    async (ctx, input) => {
      const { data, tags } = await placeManualOrder(ctx, input);
      let link: ManualOrderPaymentLink | null = null;
      if (data.paymentLink) {
        const url = checkoutResultUrl(data.locale, data.code);
        link = { provider: data.paymentLink, url, gatewayUrl: null, expiresAt: null, error: null };
        try {
          const session = await createPaymentSession(await paymentDeps(), {
            orderId: data.orderId,
            provider: data.paymentLink,
            ipAddress: ctx.ip,
            returnUrl: url,
          });
          link.gatewayUrl = session.checkoutUrl;
          link.expiresAt = session.expiresAt?.toISOString() ?? null;
        } catch (error) {
          link.error =
            error instanceof DomainError
              ? (error.fieldErrors[0]?.code ?? error.code)
              : 'unexpected';
          logger.warn('admin.manual_order.payment_session_failed', {
            orderId: data.orderId,
            provider: data.paymentLink,
            ...errorFields(error),
          });
        }
      }
      return { data: { ...data, link }, tags };
    },
    // The form shows the result panel itself; the order pages are revalidated by tag.
    { refresh: false },
  );
}
