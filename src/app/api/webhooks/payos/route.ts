import { NextResponse } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import {
  getPaymentGateways,
  getWebhookAllowlists,
  isWebhookSourceAllowed,
} from '@/server/integrations/payments';
import { getProducer } from '@/server/jobs/producer';
import { resolveClientIp } from '@/server/lib/client-ip';
import { errorFields, logger } from '@/server/lib/logger';
import { processGatewayNotification } from '@/server/modules/payment';

/**
 * payOS webhook (POST JSON, ARCHITECTURE.md §5.3, §12 Payments). No session: the HMAC-SHA256
 * signature over `data` replaces `requirePermission`. Every call is stored in
 * `payment_events`; replays and unmatched/mismatched events are acknowledged (2xx) so payOS
 * stops retrying — they changed nothing and staff are alerted. Calls from outside the optional
 * gateway IP allowlist (`PAYOS_WEBHOOK_ALLOWED_IPS`) get 403 before the body is read.
 */

const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  code: z.string().max(10).optional(),
  desc: z.string().max(500).optional(),
  success: z.boolean().optional(),
  data: z.record(z.string().max(64), z.unknown()),
  signature: z.string().max(256),
});

export async function POST(request: Request) {
  const sourceIp = resolveClientIp(request.headers, serverEnv().TRUSTED_IP_HEADER);
  if (!isWebhookSourceAllowed(getWebhookAllowlists(), 'payos', sourceIp)) {
    // Gateway servers, not customers: the source IP is not personal data.
    logger.warn('payment.webhook.ip_rejected', { provider: 'payos', sourceIp });
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const gateway = getPaymentGateways().payos;
  if (!gateway) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const parsed = bodySchema.safeParse(json);
  // Malformed bodies are still recorded (as invalid) for the webhook log.
  const notification = gateway.parseNotification(parsed.success ? parsed.data : json);

  try {
    const result = await processGatewayNotification(
      { db: getDb(), boss: await getProducer() },
      notification,
    );
    if (result.outcome === 'invalid_signature') {
      logger.warn('payment.webhook.rejected', { provider: 'payos', outcome: result.outcome });
      return NextResponse.json({ success: false, error: 'invalid_signature' }, { status: 401 });
    }
    return NextResponse.json({ success: true, outcome: result.outcome });
  } catch (error) {
    logger.error('payment.webhook.failed', { provider: 'payos', ...errorFields(error) });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
