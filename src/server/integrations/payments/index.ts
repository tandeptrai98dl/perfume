import { serverEnv, type ServerEnv } from '@/lib/env';

import { createPayosGateway } from './payos';
import type { FetchLike, GatewayProvider, PaymentGateway } from './types';
import { createVnpayGateway } from './vnpay';

/*
 * Gateway registry built from env (ADR-0007). A gateway without keys runs as the sandbox
 * simulator outside production (or everywhere with PAYMENT_SIMULATOR=true, which env.ts only
 * allows on localhost in production); otherwise it is `null` = not offered.
 *
 * Simulator keys are public on purpose: anything signed with them is test data.
 */

export const SIMULATOR_KEYS = {
  vnpayTmnCode: 'SANDBOX1',
  vnpayHashSecret: 'dev-only-vnpay-hash-secret-not-for-production',
  payosClientId: 'sandbox-client',
  payosApiKey: 'sandbox-api-key',
  payosChecksumKey: 'dev-only-payos-checksum-key-not-for-production',
} as const;

/** Path of the simulated VNPay payment page (redirects back like VNPay does). */
export const VNPAY_SIMULATOR_PATH = '/api/payments/simulator/vnpay';

export type PaymentGateways = Record<GatewayProvider, PaymentGateway | null>;

type GatewayEnv = Pick<
  ServerEnv,
  | 'NODE_ENV'
  | 'APP_URL'
  | 'VNPAY_TMN_CODE'
  | 'VNPAY_HASH_SECRET'
  | 'VNPAY_PAYMENT_URL'
  | 'VNPAY_API_URL'
  | 'PAYOS_CLIENT_ID'
  | 'PAYOS_API_KEY'
  | 'PAYOS_CHECKSUM_KEY'
  | 'PAYOS_API_URL'
  | 'PAYMENT_SIMULATOR'
>;

function simulatorFor(env: GatewayEnv, hasKeys: boolean): boolean {
  if (env.PAYMENT_SIMULATOR === true) return true;
  if (env.PAYMENT_SIMULATOR === false) return false;
  return !hasKeys && env.NODE_ENV !== 'production';
}

export function createPaymentGateways(
  env: GatewayEnv,
  options: { fetch?: FetchLike } = {},
): PaymentGateways {
  const vnpayKeys = !!(env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET);
  const vnpaySim = simulatorFor(env, vnpayKeys);
  const vnpay =
    vnpaySim || vnpayKeys
      ? createVnpayGateway(
          vnpaySim
            ? {
                mode: 'simulator',
                tmnCode: SIMULATOR_KEYS.vnpayTmnCode,
                hashSecret: SIMULATOR_KEYS.vnpayHashSecret,
                paymentUrl: `${env.APP_URL.replace(/\/+$/, '')}${VNPAY_SIMULATOR_PATH}`,
                apiUrl: env.VNPAY_API_URL,
              }
            : {
                mode: 'live',
                tmnCode: env.VNPAY_TMN_CODE!,
                hashSecret: env.VNPAY_HASH_SECRET!,
                paymentUrl: env.VNPAY_PAYMENT_URL,
                apiUrl: env.VNPAY_API_URL,
                fetch: options.fetch,
              },
        )
      : null;

  const payosKeys = !!(env.PAYOS_CLIENT_ID && env.PAYOS_API_KEY && env.PAYOS_CHECKSUM_KEY);
  const payosSim = simulatorFor(env, payosKeys);
  const payos =
    payosSim || payosKeys
      ? createPayosGateway(
          payosSim
            ? {
                mode: 'simulator',
                clientId: SIMULATOR_KEYS.payosClientId,
                apiKey: SIMULATOR_KEYS.payosApiKey,
                checksumKey: SIMULATOR_KEYS.payosChecksumKey,
                apiUrl: env.PAYOS_API_URL,
              }
            : {
                mode: 'live',
                clientId: env.PAYOS_CLIENT_ID!,
                apiKey: env.PAYOS_API_KEY!,
                checksumKey: env.PAYOS_CHECKSUM_KEY!,
                apiUrl: env.PAYOS_API_URL,
                fetch: options.fetch,
              },
        )
      : null;

  return { vnpay, payos };
}

let cached: PaymentGateways | undefined;

/** Process-wide gateways from the validated env (web app and worker). */
export function getPaymentGateways(): PaymentGateways {
  cached ??= createPaymentGateways(serverEnv());
  return cached;
}

export {
  createPayosGateway,
  payosDescription,
  payosRequestSignature,
  payosSign,
  payosSignData,
} from './payos';
export {
  createVnpayGateway,
  VNPAY_IPN_RESPONSES,
  VNPAY_RESPONSE_CODES,
  vnpaySign,
  vnpaySignData,
  vnpaySignedQuery,
} from './vnpay';
export { vnCompactDate } from './shared';
export * from './types';
