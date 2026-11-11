import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createPaymentGateways, SIMULATOR_KEYS } from '.';
import {
  createPayosGateway,
  payosDescription,
  payosRequestSignature,
  payosSign,
  payosSignData,
} from './payos';
import { parseVnCompactDate, vnCompactDate } from './shared';
import { createVnpayGateway, vnpaySign, vnpaySignData, vnpaySignedQuery } from './vnpay';

const hmac = (algo: 'sha256' | 'sha512', key: string, text: string) =>
  createHmac(algo, key).update(text, 'utf8').digest('hex');

const VNPAY_SECRET = 'TESTSECRETKEY0123456789ABCDEFGHIJ';

const vnpay = createVnpayGateway({
  mode: 'live',
  tmnCode: 'TESTTMN1',
  hashSecret: VNPAY_SECRET,
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
});

/** IPN fixture as VNPay sends it (query parameters, already URL-decoded by the framework). */
const IPN_PARAMS = {
  vnp_Amount: '125000000',
  vnp_BankCode: 'NCB',
  vnp_BankTranNo: 'VNP14226112',
  vnp_CardType: 'ATM',
  vnp_OrderInfo: 'Thanh toan don hang PF2611117K3Q',
  vnp_PayDate: '20261111153012',
  vnp_ResponseCode: '00',
  vnp_TmnCode: 'TESTTMN1',
  vnp_TransactionNo: '14226112',
  vnp_TransactionStatus: '00',
  vnp_TxnRef: '2611111530001234',
};

describe('VNPay signature', () => {
  it('signs sorted, URL-encoded pairs with spaces as "+"', () => {
    const data = vnpaySignData({
      vnp_TxnRef: '1',
      vnp_Amount: '100',
      vnp_OrderInfo: 'Don hang A&B',
    });
    expect(data).toBe('vnp_Amount=100&vnp_OrderInfo=Don+hang+A%26B&vnp_TxnRef=1');
    expect(
      vnpaySign({ vnp_TxnRef: '1', vnp_Amount: '100', vnp_OrderInfo: 'Don hang A&B' }, 'k'),
    ).toBe(hmac('sha512', 'k', data));
  });

  it('ignores the hash fields and non-vnp parameters', () => {
    const base = { vnp_Amount: '100', vnp_TxnRef: '1' };
    expect(
      vnpaySignData({ ...base, vnp_SecureHash: 'x', vnp_SecureHashType: 'HmacSHA512', code: 'PF' }),
    ).toBe(vnpaySignData(base));
  });

  it('builds a payment URL VNPay can verify (amount × 100, GMT+7 dates, plain order info)', async () => {
    const createdAt = new Date('2026-11-11T08:30:00Z');
    const session = await vnpay.createSession({
      txnRef: '2611111530001234',
      amount: 1_250_000,
      orderCode: 'PF-261111-7K3Q',
      description: 'Đơn hàng PF-261111-7K3Q',
      locale: 'en',
      returnUrl: 'https://shop.example/en/checkout/result?code=PF-261111-7K3Q',
      cancelUrl: 'https://shop.example/en/checkout/result?code=PF-261111-7K3Q',
      ipAddress: '203.0.113.9',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
    });
    const url = new URL(session.checkoutUrl!);
    const params = Object.fromEntries(url.searchParams.entries());
    expect(params).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'TESTTMN1',
      vnp_Amount: '125000000',
      vnp_CurrCode: 'VND',
      vnp_Locale: 'en',
      vnp_CreateDate: '20261111153000',
      vnp_ExpireDate: '20261111154500',
      vnp_OrderInfo: 'Don hang PF-261111-7K3Q',
    });
    expect(params.vnp_SecureHash).toBe(vnpaySign(params, VNPAY_SECRET));
  });

  it('verifies a genuine IPN and normalizes it', () => {
    const query = new URLSearchParams(
      vnpaySignedQuery(IPN_PARAMS, VNPAY_SECRET).replace(/\+/g, '%20'),
    );
    const n = vnpay.parseNotification(query);
    expect(n).toMatchObject({
      provider: 'vnpay',
      signatureValid: true,
      txnRef: '2611111530001234',
      amount: 1_250_000,
      success: true,
      providerTxnId: '14226112',
      bankCode: 'NCB',
      idempotencyKey: 'vnpay:2611111530001234:14226112:00:00',
    });
    expect(n.paidAt?.toISOString()).toBe('2026-11-11T08:30:12.000Z');
  });

  it('rejects a tampered amount, a foreign terminal and a missing hash', () => {
    const signed = { ...IPN_PARAMS, vnp_SecureHash: vnpaySign(IPN_PARAMS, VNPAY_SECRET) };
    expect(vnpay.parseNotification({ ...signed, vnp_Amount: '100' }).signatureValid).toBe(false);
    const foreign = { ...IPN_PARAMS, vnp_TmnCode: 'OTHER' };
    expect(
      vnpay.parseNotification({ ...foreign, vnp_SecureHash: vnpaySign(foreign, VNPAY_SECRET) })
        .signatureValid,
    ).toBe(false);
    const missing = vnpay.parseNotification(IPN_PARAMS);
    expect(missing.signatureValid).toBe(false);
    expect(missing.idempotencyKey).toMatch(/^invalid:vnpay:[0-9a-f]{64}$/);
  });

  it('reports a failed payment (customer cancelled) as not successful', () => {
    const cancelled = { ...IPN_PARAMS, vnp_ResponseCode: '24', vnp_TransactionStatus: '02' };
    const n = vnpay.parseNotification({
      ...cancelled,
      vnp_SecureHash: vnpaySign(cancelled, VNPAY_SECRET),
    });
    expect(n.signatureValid).toBe(true);
    expect(n.success).toBe(false);
    expect(n.eventType).toBe('ipn:24');
  });

  it('calls the refund API with a pipe-joined HMAC and verifies the response', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as Record<string, string>;
      const expected = [
        body.vnp_RequestId,
        '2.1.0',
        'refund',
        'TESTTMN1',
        '03',
        '2611111530001234',
        '50000000',
        '14226112',
        '20261111153000',
        'manager',
        body.vnp_CreateDate,
        '127.0.0.1',
        'late payment',
      ].join('|');
      expect(body.vnp_SecureHash).toBe(hmac('sha512', VNPAY_SECRET, expected));
      const response: Record<string, string> = {
        vnp_ResponseId: 'r1',
        vnp_Command: 'refund',
        vnp_ResponseCode: '00',
        vnp_Message: 'OK',
        vnp_TmnCode: 'TESTTMN1',
        vnp_TxnRef: body.vnp_TxnRef!,
        vnp_Amount: body.vnp_Amount!,
        vnp_BankCode: 'NCB',
        vnp_PayDate: '20261111160000',
        vnp_TransactionNo: '99887766',
        vnp_TransactionType: '03',
        vnp_TransactionStatus: '05',
        vnp_OrderInfo: body.vnp_OrderInfo!,
      };
      const fields = Object.values(response).join('|');
      response.vnp_SecureHash = hmac('sha512', VNPAY_SECRET, fields);
      return new Response(JSON.stringify(response));
    });
    const gateway = createVnpayGateway({
      mode: 'live',
      tmnCode: 'TESTTMN1',
      hashSecret: VNPAY_SECRET,
      paymentUrl: 'https://x',
      apiUrl: 'https://api.example/refund',
      fetch: fetchMock,
    });
    const result = await gateway.refund!({
      txnRef: '2611111530001234',
      providerTxnId: '14226112',
      amount: 500_000,
      paymentAmount: 1_250_000,
      transactionDate: new Date('2026-11-11T08:30:00Z'),
      reason: 'late payment',
      actor: 'manager',
      ipAddress: '127.0.0.1',
      now: new Date('2026-11-11T09:00:00Z'),
    });
    expect(result).toMatchObject({ ok: true, providerRef: '99887766' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

const PAYOS_KEY = 'payos-test-checksum-key';

/** Webhook body in the shape documented by payOS. */
function payosWebhook(overrides: Record<string, unknown> = {}) {
  const data = {
    orderCode: 2611111530001234,
    amount: 250_000,
    description: 'PF2611117K3Q',
    accountNumber: '12345678',
    reference: 'TF230204212323',
    transactionDateTime: '2026-11-11 15:31:00',
    currency: 'VND',
    paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
    code: '00',
    desc: 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '190366668888',
    virtualAccountName: '',
    virtualAccountNumber: '',
    ...overrides,
  };
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: payosSign(data, PAYOS_KEY),
  };
}

const payos = createPayosGateway({
  mode: 'live',
  clientId: 'client',
  apiKey: 'api-key',
  checksumKey: PAYOS_KEY,
  apiUrl: 'https://api-merchant.payos.vn',
});

describe('payOS signature', () => {
  it('builds the canonical string with sorted keys, empty nulls and JSON arrays', () => {
    expect(
      payosSignData({
        orderCode: 123,
        amount: 3000,
        desc: null,
        items: [{ quantity: 1, name: 'A' }],
        b: undefined,
      }),
    ).toBe('amount=3000&desc=&items=[{"name":"A","quantity":1}]&orderCode=123');
  });

  it('signs payment requests over amount, cancelUrl, description, orderCode, returnUrl', () => {
    const request = {
      orderCode: 123,
      amount: 3000,
      description: 'VQRIO123',
      cancelUrl: 'https://shop.example/cancel',
      returnUrl: 'https://shop.example/return',
    };
    expect(payosRequestSignature(request, PAYOS_KEY)).toBe(
      hmac(
        'sha256',
        PAYOS_KEY,
        'amount=3000&cancelUrl=https://shop.example/cancel&description=VQRIO123&orderCode=123&returnUrl=https://shop.example/return',
      ),
    );
  });

  it('verifies a webhook, masks counter-party details and builds the idempotency key', () => {
    const n = payos.parseNotification(payosWebhook());
    expect(n).toMatchObject({
      signatureValid: true,
      success: true,
      txnRef: '2611111530001234',
      amount: 250_000,
      idempotencyKey: 'payos:2611111530001234:TF230204212323:00',
      providerTxnId: 'TF230204212323',
    });
    expect(n.paidAt?.toISOString()).toBe('2026-11-11T08:31:00.000Z');
    const stored = (n.payload as { data: Record<string, unknown> }).data;
    expect(stored.counterAccountName).toBe('***N A');
    expect(stored.counterAccountNumber).toBe('***888');
    expect(JSON.stringify(n.payload)).not.toContain('NGUYEN VAN A');
  });

  it('rejects a webhook whose data changed after signing', () => {
    const body = payosWebhook();
    const n = payos.parseNotification({ ...body, data: { ...body.data, amount: 1 } });
    expect(n.signatureValid).toBe(false);
    expect(n.idempotencyKey).toMatch(/^invalid:payos:/);
    expect(payos.parseNotification('garbage').signatureValid).toBe(false);
  });

  it('creates a payment link through the injected fetch and checks the response signature', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api-merchant.payos.vn/v2/payment-requests');
      const headers = init!.headers as Record<string, string>;
      expect(headers['x-client-id']).toBe('client');
      expect(headers['x-api-key']).toBe('api-key');
      const body = JSON.parse(String(init!.body)) as Record<string, string | number>;
      expect(body.signature).toBe(
        payosRequestSignature(body as Parameters<typeof payosRequestSignature>[0], PAYOS_KEY),
      );
      expect(body.description).toBe('PF2611117K3Q');
      expect(body.expiredAt).toBe(1_794_386_700);
      const data = {
        bin: '970422',
        accountNumber: '113366668888',
        accountName: 'CONG TY PERFUME',
        amount: body.amount,
        description: body.description,
        orderCode: body.orderCode,
        currency: 'VND',
        paymentLinkId: 'link-1',
        status: 'PENDING',
        checkoutUrl: 'https://pay.payos.vn/web/link-1',
        qrCode: '00020101021238570010A000000727',
      };
      return new Response(
        JSON.stringify({
          code: '00',
          desc: 'success',
          data,
          signature: payosSign(data, PAYOS_KEY),
        }),
      );
    });
    const gateway = createPayosGateway({
      mode: 'live',
      clientId: 'client',
      apiKey: 'api-key',
      checksumKey: PAYOS_KEY,
      apiUrl: 'https://api-merchant.payos.vn/',
      fetch: fetchMock,
    });
    const session = await gateway.createSession({
      txnRef: '2611111530001234',
      amount: 250_000,
      orderCode: 'PF-261111-7K3Q',
      description: 'PF2611117K3Q',
      locale: 'vi',
      returnUrl: 'https://shop.example/r',
      cancelUrl: 'https://shop.example/r',
      ipAddress: '127.0.0.1',
      createdAt: new Date('2026-11-11T08:30:00Z'),
      expiresAt: new Date('2026-11-11T08:45:00Z'),
    });
    expect(session).toMatchObject({
      checkoutUrl: 'https://pay.payos.vn/web/link-1',
      qrCode: '00020101021238570010A000000727',
      providerTxnId: 'link-1',
      account: { bin: '970422', accountNumber: '113366668888', accountName: 'CONG TY PERFUME' },
    });
  });

  it('refuses a payment-link response that does not match the request', async () => {
    const gateway = createPayosGateway({
      mode: 'live',
      clientId: 'c',
      apiKey: 'k',
      checksumKey: PAYOS_KEY,
      apiUrl: 'https://x',
      fetch: async () => new Response(JSON.stringify({ code: '231', desc: 'exists', data: null })),
    });
    await expect(
      gateway.createSession({
        txnRef: '1',
        amount: 1,
        orderCode: 'PF',
        description: 'PF',
        locale: 'vi',
        returnUrl: 'https://r',
        cancelUrl: 'https://r',
        ipAddress: '127.0.0.1',
        createdAt: new Date(),
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ reason: 'response_231' });
  });

  it('keeps transfer notes bank-safe and within 25 characters', () => {
    expect(payosDescription('Thanh toán PF-261111-7K3Q')).toBe('Thanh toan PF2611117K3Q');
    expect(payosDescription('x'.repeat(40))).toHaveLength(25);
  });
});

describe('gateway registry', () => {
  const base = {
    NODE_ENV: 'development' as const,
    APP_URL: 'http://localhost:3000',
    VNPAY_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    VNPAY_API_URL: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    PAYOS_API_URL: 'https://api-merchant.payos.vn',
  };

  it('uses the simulator without keys outside production, nothing in production', () => {
    const dev = createPaymentGateways(base);
    expect(dev.vnpay?.mode).toBe('simulator');
    expect(dev.payos?.mode).toBe('simulator');
    const prod = createPaymentGateways({ ...base, NODE_ENV: 'production' });
    expect(prod).toEqual({ vnpay: null, payos: null });
  });

  it('uses live gateways when keys are set, unless the simulator is forced', () => {
    const keys = {
      VNPAY_TMN_CODE: 'T',
      VNPAY_HASH_SECRET: 'S',
      PAYOS_CLIENT_ID: 'c',
      PAYOS_API_KEY: 'k',
      PAYOS_CHECKSUM_KEY: 'x',
    };
    const live = createPaymentGateways({ ...base, NODE_ENV: 'production', ...keys });
    expect([live.vnpay?.mode, live.payos?.mode]).toEqual(['live', 'live']);
    const forced = createPaymentGateways({ ...base, ...keys, PAYMENT_SIMULATOR: true });
    expect([forced.vnpay?.mode, forced.payos?.mode]).toEqual(['simulator', 'simulator']);
  });

  it('simulator sessions are verifiable with the public simulator keys', async () => {
    const { payos: sim } = createPaymentGateways(base);
    const session = await sim!.createSession({
      txnRef: '2611111530001234',
      amount: 99_000,
      orderCode: 'PF-261111-7K3Q',
      description: 'PF2611117K3Q',
      locale: 'vi',
      returnUrl: 'http://localhost:3000/r',
      cancelUrl: 'http://localhost:3000/r',
      ipAddress: '127.0.0.1',
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    expect(session.qrCode).toContain('2611111530001234');
    const data = { orderCode: 2611111530001234, amount: 99_000, code: '00', reference: 'SIM1' };
    const n = sim!.parseNotification({
      code: '00',
      data,
      signature: payosSign(data, SIMULATOR_KEYS.payosChecksumKey),
    });
    expect(n.signatureValid).toBe(true);
  });
});

describe('Vietnam time helpers', () => {
  it('round-trips compact GMT+7 dates', () => {
    const date = new Date('2026-12-31T17:59:59Z');
    expect(vnCompactDate(date)).toBe('20270101005959');
    expect(parseVnCompactDate('20270101005959')?.toISOString()).toBe(date.toISOString());
    expect(parseVnCompactDate('bad')).toBeNull();
  });
});
