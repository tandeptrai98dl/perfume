import { createHmac, randomBytes } from 'node:crypto';

import { invalidEventKey, parseVnCompactDate, sameHex, vnCompactDate } from './shared';
import {
  type CreateSessionInput,
  type CreateSessionResult,
  type FetchLike,
  type GatewayMode,
  type GatewayNotification,
  type PaymentGateway,
  type RefundInput,
  type RefundResult,
} from './types';

/*
 * VNPay payment gateway, API version 2.1.0 (sandbox: sandbox.vnpayment.vn).
 * - Payment URL: every `vnp_*` parameter, keys sorted ascending, key and value URL-encoded
 *   (encodeURIComponent, spaces as "+"), joined as `k=v&…`; `vnp_SecureHash` is the hex
 *   HMAC-SHA512 of that string with the hash secret. Amount is VND × 100.
 * - IPN (GET to our IPN URL): same scheme over the received `vnp_*` parameters without
 *   `vnp_SecureHash` / `vnp_SecureHashType`. Success = `vnp_ResponseCode` and
 *   `vnp_TransactionStatus` both "00". We answer `{ RspCode, Message }` (VNPAY_IPN_RESPONSES).
 * - Refund (merchant_webapi, JSON POST): HMAC-SHA512 over the "|"-joined field list below.
 */

export const VNPAY_VERSION = '2.1.0';

/** IPN acknowledgements defined by VNPay. */
export const VNPAY_IPN_RESPONSES = {
  success: { RspCode: '00', Message: 'Confirm Success' },
  orderNotFound: { RspCode: '01', Message: 'Order not found' },
  alreadyConfirmed: { RspCode: '02', Message: 'Order already confirmed' },
  invalidAmount: { RspCode: '04', Message: 'invalid amount' },
  invalidSignature: { RspCode: '97', Message: 'Invalid signature' },
  unknownError: { RspCode: '99', Message: 'Unknown error' },
} as const;

/** `vnp_ResponseCode` meanings (subset shown to staff in the webhook log). */
export const VNPAY_RESPONSE_CODES: Record<string, string> = {
  '00': 'success',
  '07': 'suspected_fraud',
  '09': 'internet_banking_not_registered',
  '10': 'authentication_failed',
  '11': 'payment_timeout',
  '12': 'card_locked',
  '13': 'wrong_otp',
  '24': 'customer_cancelled',
  '51': 'insufficient_balance',
  '65': 'daily_limit_exceeded',
  '75': 'bank_maintenance',
  '79': 'wrong_password_too_many_times',
  '99': 'other_error',
};

function encode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

/** The exact string VNPay signs: sorted, encoded `k=v` pairs joined with "&". */
export function vnpaySignData(params: Record<string, string>): string {
  return Object.keys(params)
    .filter(
      (key) => key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType',
    )
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key] ?? '')}`)
    .join('&');
}

export function vnpaySign(params: Record<string, string>, hashSecret: string): string {
  return createHmac('sha512', hashSecret).update(vnpaySignData(params), 'utf8').digest('hex');
}

/** Signed query string (`…&vnp_SecureHash=…`), as VNPay builds IPN and return URLs. */
export function vnpaySignedQuery(params: Record<string, string>, hashSecret: string): string {
  return `${vnpaySignData(params)}&vnp_SecureHash=${vnpaySign(params, hashSecret)}`;
}

export type VnpayConfig = {
  tmnCode: string;
  hashSecret: string;
  paymentUrl: string;
  apiUrl: string;
  mode: GatewayMode;
  fetch?: FetchLike;
};

/** Removes diacritics and characters VNPay rejects in `vnp_OrderInfo`. */
function plainText(value: string, max = 255): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 .,:_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toRecord(input: unknown): Record<string, string> | null {
  if (input instanceof URLSearchParams) return Object.fromEntries(input.entries());
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function createVnpayGateway(config: VnpayConfig): PaymentGateway {
  return {
    provider: 'vnpay',
    mode: config.mode,

    async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
      const params: Record<string, string> = {
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'pay',
        vnp_TmnCode: config.tmnCode,
        vnp_Amount: String(input.amount * 100),
        vnp_CurrCode: 'VND',
        vnp_TxnRef: input.txnRef,
        vnp_OrderInfo: plainText(input.description),
        vnp_OrderType: 'other',
        vnp_Locale: input.locale === 'en' ? 'en' : 'vn',
        vnp_ReturnUrl: input.returnUrl,
        vnp_IpAddr: input.ipAddress,
        vnp_CreateDate: vnCompactDate(input.createdAt),
        vnp_ExpireDate: vnCompactDate(input.expiresAt),
      };
      const checkoutUrl = `${config.paymentUrl}?${vnpaySignedQuery(params, config.hashSecret)}`;
      return {
        checkoutUrl,
        qrCode: null,
        providerTxnId: null,
        account: null,
        raw: { createDate: params.vnp_CreateDate, expireDate: params.vnp_ExpireDate },
      };
    },

    parseNotification(input: unknown): GatewayNotification {
      const params = toRecord(input) ?? {};
      const payload = Object.fromEntries(
        Object.entries(params).filter(([key]) => key.startsWith('vnp_')),
      );
      const valid =
        params.vnp_TmnCode === config.tmnCode &&
        sameHex(vnpaySign(params, config.hashSecret), params.vnp_SecureHash);
      const rawAmount = Number(params.vnp_Amount);
      const amount =
        Number.isSafeInteger(rawAmount) && rawAmount > 0 && rawAmount % 100 === 0
          ? rawAmount / 100
          : null;
      const responseCode = params.vnp_ResponseCode ?? '';
      const transactionStatus = params.vnp_TransactionStatus ?? '';
      return {
        provider: 'vnpay',
        signatureValid: valid,
        idempotencyKey: valid
          ? `vnpay:${params.vnp_TxnRef}:${params.vnp_TransactionNo ?? ''}:${responseCode}:${transactionStatus}`
          : invalidEventKey('vnpay', payload),
        eventType: `ipn:${responseCode || 'unknown'}`,
        txnRef: params.vnp_TxnRef ?? null,
        amount,
        success: responseCode === '00' && transactionStatus === '00',
        providerTxnId: params.vnp_TransactionNo || null,
        bankCode: params.vnp_BankCode || null,
        paidAt: parseVnCompactDate(params.vnp_PayDate),
        payload,
      };
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      const requestId = randomBytes(16).toString('hex');
      const body: Record<string, string> = {
        vnp_RequestId: requestId,
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'refund',
        vnp_TmnCode: config.tmnCode,
        vnp_TransactionType: input.amount >= input.paymentAmount ? '02' : '03',
        vnp_TxnRef: input.txnRef,
        vnp_Amount: String(input.amount * 100),
        vnp_TransactionNo: input.providerTxnId ?? '',
        vnp_TransactionDate: vnCompactDate(input.transactionDate),
        vnp_CreateBy: plainText(input.actor, 100) || 'system',
        vnp_CreateDate: vnCompactDate(input.now),
        vnp_IpAddr: input.ipAddress,
        vnp_OrderInfo: plainText(input.reason) || 'Refund',
      };
      body.vnp_SecureHash = vnpayRefundHash(body, config.hashSecret);

      if (config.mode === 'simulator') {
        return { ok: true, providerRef: `SIM-${requestId.slice(0, 12)}`, raw: { simulated: true } };
      }
      const doFetch = config.fetch ?? fetch;
      let json: Record<string, string>;
      try {
        const response = await doFetch(config.apiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        json = (await response.json()) as Record<string, string>;
      } catch {
        return { ok: false, error: 'network', raw: null };
      }
      const raw = { ...json, vnp_SecureHash: undefined };
      if (!sameHex(vnpayRefundResponseHash(json, config.hashSecret), json.vnp_SecureHash)) {
        return { ok: false, error: 'invalid_response_signature', raw };
      }
      if (json.vnp_ResponseCode !== '00') {
        return { ok: false, error: `response_${json.vnp_ResponseCode ?? 'unknown'}`, raw };
      }
      return { ok: true, providerRef: json.vnp_TransactionNo || null, raw };
    },
  };
}

const REFUND_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TransactionType',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_TransactionNo',
  'vnp_TransactionDate',
  'vnp_CreateBy',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
] as const;

const REFUND_RESPONSE_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
] as const;

function pipeHash(fields: readonly string[], data: Record<string, string>, secret: string) {
  const text = fields.map((field) => data[field] ?? '').join('|');
  return createHmac('sha512', secret).update(text, 'utf8').digest('hex');
}

export function vnpayRefundHash(data: Record<string, string>, secret: string): string {
  return pipeHash(REFUND_FIELDS, data, secret);
}

export function vnpayRefundResponseHash(data: Record<string, string>, secret: string): string {
  return pipeHash(REFUND_RESPONSE_FIELDS, data, secret);
}
