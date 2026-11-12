import { connection, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import {
  getPaymentGateways,
  getWebhookAllowlists,
  isWebhookSourceAllowed,
  VNPAY_IPN_RESPONSES,
} from '@/server/integrations/payments';
import { getProducer } from '@/server/jobs/producer';
import { resolveClientIp } from '@/server/lib/client-ip';
import { errorFields, logger } from '@/server/lib/logger';
import { processGatewayNotification, type NotificationOutcome } from '@/server/modules/payment';

/**
 * VNPay IPN (server-to-server GET, ARCHITECTURE.md §5.3, §12 Payments). No session: the
 * HMAC-SHA512 signature replaces `requirePermission`. Every call is stored in
 * `payment_events`; replays are acknowledged without side effects. Always HTTP 200 with the
 * `{ RspCode, Message }` body VNPay expects — except calls from outside the optional gateway
 * IP allowlist (`VNPAY_IPN_ALLOWED_IPS`), which get 403 before anything is parsed or stored.
 */

const querySchema = z
  .record(z.string().max(64), z.string().max(1024))
  .refine((value) => Object.keys(value).length <= 40, 'too_many_params');

const RESPONSES: Record<
  NotificationOutcome,
  (typeof VNPAY_IPN_RESPONSES)[keyof typeof VNPAY_IPN_RESPONSES]
> = {
  processed: VNPAY_IPN_RESPONSES.success,
  failed_payment: VNPAY_IPN_RESPONSES.success,
  duplicate: VNPAY_IPN_RESPONSES.alreadyConfirmed,
  already_paid: VNPAY_IPN_RESPONSES.alreadyConfirmed,
  unknown_txn: VNPAY_IPN_RESPONSES.orderNotFound,
  amount_mismatch: VNPAY_IPN_RESPONSES.invalidAmount,
  invalid_signature: VNPAY_IPN_RESPONSES.invalidSignature,
};

export async function GET(request: NextRequest) {
  await connection();
  const sourceIp = resolveClientIp(request.headers, serverEnv().TRUSTED_IP_HEADER);
  if (!isWebhookSourceAllowed(getWebhookAllowlists(), 'vnpay', sourceIp)) {
    // Gateway servers, not customers: the source IP is not personal data.
    logger.warn('payment.ipn.ip_rejected', { provider: 'vnpay', sourceIp });
    return NextResponse.json({ RspCode: '99', Message: 'Forbidden' }, { status: 403 });
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json(VNPAY_IPN_RESPONSES.invalidSignature);
  const gateway = getPaymentGateways().vnpay;
  if (!gateway) return NextResponse.json(VNPAY_IPN_RESPONSES.unknownError);

  const notification = gateway.parseNotification(parsed.data);
  try {
    const result = await processGatewayNotification(
      { db: getDb(), boss: await getProducer() },
      notification,
    );
    if (result.outcome !== 'processed' && result.outcome !== 'duplicate') {
      logger.warn('payment.ipn.rejected', { provider: 'vnpay', outcome: result.outcome });
    }
    return NextResponse.json(RESPONSES[result.outcome]);
  } catch (error) {
    // Not acknowledged: VNPay retries, and the retry is processed from scratch.
    logger.error('payment.ipn.failed', { provider: 'vnpay', ...errorFields(error) });
    return NextResponse.json(VNPAY_IPN_RESPONSES.unknownError);
  }
}
