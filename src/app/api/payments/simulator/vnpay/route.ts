import { randomInt } from 'node:crypto';

import { connection, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import {
  getPaymentGateways,
  SIMULATOR_KEYS,
  vnCompactDate,
  vnpaySign,
  vnpaySignedQuery,
} from '@/server/integrations/payments';
import { getProducer } from '@/server/jobs/producer';
import { processGatewayNotification } from '@/server/modules/payment';

/**
 * Sandbox stand-in for the VNPay payment page (only when VNPay runs as the simulator: no keys
 * outside production, or PAYMENT_SIMULATOR=true on localhost). It checks the signed payment
 * URL, sends the signed IPN through the real processing path (as VNPay's server would), then
 * redirects to the return URL with signed `vnp_*` parameters. `?vnp_SimulateResult=24`
 * simulates a customer who cancels on the gateway.
 */

const querySchema = z.record(z.string().max(64), z.string().max(2048));

export async function GET(request: NextRequest) {
  await connection();
  const gateway = getPaymentGateways().vnpay;
  if (gateway?.mode !== 'simulator') return new NextResponse(null, { status: 404 });

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const { vnp_SimulateResult: simulated, ...params } = parsed.data;
  if (vnpaySign(params, SIMULATOR_KEYS.vnpayHashSecret) !== params.vnp_SecureHash) {
    return new NextResponse(null, { status: 400 });
  }
  const returnUrl = new URL(params.vnp_ReturnUrl ?? '/', serverEnv().APP_URL);
  if (returnUrl.origin !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 400 });
  }

  const responseCode = simulated === '24' ? '24' : '00';
  const ipn: Record<string, string> = {
    vnp_Amount: params.vnp_Amount ?? '0',
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: `VNP${randomInt(10_000_000, 99_999_999)}`,
    vnp_CardType: 'ATM',
    vnp_OrderInfo: params.vnp_OrderInfo ?? '',
    vnp_PayDate: vnCompactDate(new Date()),
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: SIMULATOR_KEYS.vnpayTmnCode,
    vnp_TransactionNo: String(randomInt(10_000_000, 99_999_999)),
    vnp_TransactionStatus: responseCode === '00' ? '00' : '02',
    vnp_TxnRef: params.vnp_TxnRef ?? '',
  };
  await processGatewayNotification(
    { db: getDb(), boss: await getProducer() },
    gateway.parseNotification({
      ...ipn,
      vnp_SecureHash: vnpaySign(ipn, SIMULATOR_KEYS.vnpayHashSecret),
    }),
  );

  const signed = new URLSearchParams(vnpaySignedQuery(ipn, SIMULATOR_KEYS.vnpayHashSecret));
  for (const [key, value] of signed) returnUrl.searchParams.set(key, value);
  return NextResponse.redirect(returnUrl, 303);
}
