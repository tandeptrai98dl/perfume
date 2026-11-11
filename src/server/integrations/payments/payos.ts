import { createHmac } from 'node:crypto';

import { invalidEventKey, maskTail, parseVnDateTime, sameHex } from './shared';
import {
  GatewayError,
  type BankAccount,
  type CreateSessionInput,
  type CreateSessionResult,
  type FetchLike,
  type GatewayMode,
  type GatewayNotification,
  type PaymentGateway,
} from './types';

/*
 * payOS (VietQR) adapter, API v2 (api-merchant.payos.vn).
 * - Create link: POST /v2/payment-requests with `x-client-id` / `x-api-key`; `signature` is
 *   HMAC-SHA256 (checksum key) over
 *   `amount=…&cancelUrl=…&description=…&orderCode=…&returnUrl=…` (keys alphabetical).
 *   `orderCode` is a positive integer: our numeric `txn_ref`. `expiredAt` is Unix seconds.
 * - Webhook: POST `{ code, desc, success, data, signature }`; `signature` is HMAC-SHA256 over
 *   `data` with keys sorted, `key=value` joined by "&", null/undefined as "" and arrays as JSON
 *   of key-sorted objects. Success = `code` and `data.code` both "00".
 * - payOS has no refund API: refunds of payOS payments are bank transfers recorded manually.
 */

export const PAYOS_DESCRIPTION_MAX = 25;

function sortByKey(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

/** payOS canonical string of a flat object (see header comment). */
export function payosSignData(data: Record<string, unknown>): string {
  const sorted = sortByKey(data);
  return Object.keys(sorted)
    .filter((key) => sorted[key] !== undefined)
    .map((key) => {
      let value = sorted[key];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((item) =>
            item && typeof item === 'object' ? sortByKey(item as Record<string, unknown>) : item,
          ),
        );
      }
      if (value === null || value === undefined || value === 'undefined' || value === 'null') {
        value = '';
      }
      return `${key}=${String(value)}`;
    })
    .join('&');
}

export function payosSign(data: Record<string, unknown>, checksumKey: string): string {
  return createHmac('sha256', checksumKey).update(payosSignData(data), 'utf8').digest('hex');
}

/** Signature of a payment-link request (only these five fields are signed). */
export function payosRequestSignature(
  request: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  },
  checksumKey: string,
): string {
  return payosSign(
    {
      amount: request.amount,
      cancelUrl: request.cancelUrl,
      description: request.description,
      orderCode: request.orderCode,
      returnUrl: request.returnUrl,
    },
    checksumKey,
  );
}

export type PayosConfig = {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  apiUrl: string;
  mode: GatewayMode;
  fetch?: FetchLike;
};

/** Banks accept only unaccented letters, digits and spaces in transfer notes. */
export function payosDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PAYOS_DESCRIPTION_MAX);
}

/** Counter-party fields are the customer's bank details (PII): masked before storage. */
const PII_FIELDS = new Set([
  'counterAccountName',
  'counterAccountNumber',
  'virtualAccountName',
  'virtualAccountNumber',
]);

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      PII_FIELDS.has(key) ? maskTail(value) : value,
    ]),
  );
}

type PayosEnvelope = {
  code?: unknown;
  desc?: unknown;
  data?: unknown;
  signature?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A simulated VietQR payload (not scannable by banking apps; dev/E2E only). */
function simulatedQr(input: CreateSessionInput): string {
  return `SANDBOX|PAYOS|${input.txnRef}|${input.amount}|${input.description}`;
}

export const PAYOS_SIMULATOR_ACCOUNT: BankAccount = {
  bin: '970422',
  accountNumber: '0000000000',
  accountName: 'PERFUME STORE SANDBOX',
};

export function createPayosGateway(config: PayosConfig): PaymentGateway {
  return {
    provider: 'payos',
    mode: config.mode,

    async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
      const orderCode = Number(input.txnRef);
      if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
        throw new GatewayError('payos', 'invalid_order_code');
      }
      const description = payosDescription(input.description);
      if (config.mode === 'simulator') {
        return {
          checkoutUrl: null,
          qrCode: simulatedQr({ ...input, description }),
          providerTxnId: `SIM${orderCode}`,
          account: PAYOS_SIMULATOR_ACCOUNT,
          raw: { simulated: true, description },
        };
      }
      const request = {
        orderCode,
        amount: input.amount,
        description,
        cancelUrl: input.cancelUrl,
        returnUrl: input.returnUrl,
        expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
      };
      const signature = payosRequestSignature(request, config.checksumKey);
      const doFetch = config.fetch ?? fetch;
      let envelope: PayosEnvelope;
      try {
        const response = await doFetch(`${config.apiUrl.replace(/\/+$/, '')}/v2/payment-requests`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-client-id': config.clientId,
            'x-api-key': config.apiKey,
          },
          body: JSON.stringify({ ...request, signature }),
        });
        envelope = (await response.json()) as PayosEnvelope;
      } catch {
        throw new GatewayError('payos', 'network');
      }
      const data = asObject(envelope.data);
      if (envelope.code !== '00' || !data) {
        throw new GatewayError('payos', `response_${String(envelope.code ?? 'unknown')}`);
      }
      if (
        typeof envelope.signature === 'string' &&
        !sameHex(payosSign(data, config.checksumKey), envelope.signature)
      ) {
        throw new GatewayError('payos', 'invalid_response_signature');
      }
      if (Number(data.amount) !== input.amount || Number(data.orderCode) !== orderCode) {
        throw new GatewayError('payos', 'response_mismatch');
      }
      return {
        checkoutUrl: typeof data.checkoutUrl === 'string' ? data.checkoutUrl : null,
        qrCode: typeof data.qrCode === 'string' ? data.qrCode : null,
        providerTxnId: typeof data.paymentLinkId === 'string' ? data.paymentLinkId : null,
        account:
          typeof data.accountNumber === 'string'
            ? {
                bin: String(data.bin ?? ''),
                accountNumber: data.accountNumber,
                accountName: String(data.accountName ?? ''),
              }
            : null,
        raw: {
          paymentLinkId: data.paymentLinkId ?? null,
          status: data.status ?? null,
          description: data.description ?? description,
        },
      };
    },

    parseNotification(input: unknown): GatewayNotification {
      const envelope = (asObject(input) ?? {}) as PayosEnvelope;
      const data = asObject(envelope.data);
      const valid =
        !!data &&
        typeof envelope.signature === 'string' &&
        sameHex(payosSign(data, config.checksumKey), envelope.signature);
      const payload = {
        code: envelope.code ?? null,
        desc: envelope.desc ?? null,
        data: data ? sanitize(data) : null,
      };
      if (!valid || !data) {
        return {
          provider: 'payos',
          signatureValid: false,
          idempotencyKey: invalidEventKey('payos', input),
          eventType: 'webhook:invalid',
          txnRef: data?.orderCode !== undefined ? String(data.orderCode) : null,
          amount: null,
          success: false,
          providerTxnId: null,
          bankCode: null,
          paidAt: null,
          payload,
        };
      }
      const amount = Number(data.amount);
      const dataCode = String(data.code ?? '');
      const reference = String(data.reference ?? '');
      return {
        provider: 'payos',
        signatureValid: true,
        idempotencyKey: `payos:${String(data.orderCode)}:${reference}:${dataCode}`,
        eventType: `webhook:${dataCode || 'unknown'}`,
        txnRef: data.orderCode !== undefined ? String(data.orderCode) : null,
        amount: Number.isSafeInteger(amount) && amount > 0 ? amount : null,
        success: envelope.code === '00' && dataCode === '00',
        providerTxnId:
          reference || (typeof data.paymentLinkId === 'string' ? data.paymentLinkId : null),
        bankCode: typeof data.counterAccountBankId === 'string' ? data.counterAccountBankId : null,
        paidAt: parseVnDateTime(data.transactionDateTime),
        payload,
      };
    },
  };
}
