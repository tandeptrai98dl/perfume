import { describe, expect, it, vi } from 'vitest';

import { parseServerEnv } from '@/lib/env';

import {
  createEinvoiceProvider,
  createMisaProvider,
  createSandboxEinvoiceProvider,
  createViettelProvider,
  EinvoiceError,
  einvoiceLookupUrl,
  sandboxInvoiceNo,
  toMisaInvoice,
  toViettelInvoice,
  type EinvoiceDocument,
} from '.';

/** Provider-neutral fixture (what the einvoice module builds; see build.test.ts). */
const doc: EinvoiceDocument = {
  refId: '01970000-0000-7000-8000-000000000001',
  orderCode: 'PF-261112-7K3Q',
  issueDate: new Date('2026-11-12T18:30:00Z'), // 13/11 in Vietnam
  currency: 'VND',
  paymentMethodName: 'TM/CK',
  buyer: {
    kind: 'company',
    name: 'Nguyễn Thị Hương',
    legalName: 'Công ty TNHH Hương Thơm',
    taxCode: '0312345678',
    address: '1 Nguyễn Huệ, Phường Sài Gòn, TP Hồ Chí Minh',
    email: 'ketoan@huongthom.vn',
    phone: '0912345678',
  },
  lines: [
    {
      lineNumber: 1,
      kind: 'goods',
      code: 'CED-100',
      name: 'Cèdre Nocturne EDT 100 ml',
      unitName: 'Chai',
      quantity: 1,
      unitPriceNet: 2_909_091,
      amountNet: 2_909_091,
      discountNet: 290_909,
      taxableAmount: 2_618_182,
      vatRate: 10,
      vatAmount: 261_818,
      grossAmount: 2_880_000,
    },
    {
      lineNumber: 2,
      kind: 'service',
      code: null,
      name: 'Phí vận chuyển',
      unitName: 'Lần',
      quantity: 1,
      unitPriceNet: 27_273,
      amountNet: 27_273,
      discountNet: 0,
      taxableAmount: 27_273,
      vatRate: 10,
      vatAmount: 2_727,
      grossAmount: 30_000,
    },
  ],
  taxBreakdown: [{ vatRate: 10, taxableAmount: 2_645_455, vatAmount: 264_545 }],
  totals: {
    amountNet: 2_936_364,
    discountNet: 290_909,
    taxableAmount: 2_645_455,
    vatAmount: 264_545,
    grossAmount: 2_910_000,
  },
  totalInWords: 'Hai triệu chín trăm mười nghìn đồng',
  note: 'Đơn hàng PF-261112-7K3Q',
};

type Call = { url: string; init: RequestInit; json: unknown };

/** Fixture server: routes by URL suffix, records every call (no network). */
function fixtureFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : '';
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = Object.fromEntries(new URLSearchParams(body));
    }
    const call = { url, init, json };
    calls.push(call);
    const route = Object.keys(routes).find((suffix) => url.split('?')[0]!.endsWith(suffix));
    if (!route) return new Response('not found', { status: 404 });
    return routes[route]!(call);
  });
  return { fetch: fetchMock, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe('MISA meInvoice adapter', () => {
  const config = {
    baseUrl: 'https://testapi.meinvoice.vn/api/integration/',
    appId: 'app-123',
    taxCode: '0109999999',
    username: 'api-user',
    password: 'secret-pass',
    series: '1C26TAA',
  };

  it('serialises the invoice to OriginalInvoiceData', () => {
    const wire = toMisaInvoice(doc, config);
    expect(wire).toMatchObject({
      RefID: doc.refId,
      InvSeries: '1C26TAA',
      InvDate: '2026-11-13',
      CurrencyCode: 'VND',
      PaymentMethodName: 'TM/CK',
      BuyerLegalName: 'Công ty TNHH Hương Thơm',
      BuyerFullName: 'Nguyễn Thị Hương',
      BuyerTaxCode: '0312345678',
      IsSendEmail: true,
      TotalAmountWithoutVATOC: 2_645_455,
      TotalVATAmountOC: 264_545,
      TotalAmountOC: 2_910_000,
      TotalAmountInWords: doc.totalInWords,
      TaxRateInfo: [{ VATRateName: '10%', AmountWithoutVATOC: 2_645_455, VATAmountOC: 264_545 }],
    });
    expect(wire.OriginalInvoiceDetail[0]).toEqual({
      ItemType: 1,
      LineNumber: 1,
      SortOrder: 1,
      ItemCode: 'CED-100',
      ItemName: 'Cèdre Nocturne EDT 100 ml',
      UnitName: 'Chai',
      Quantity: 1,
      UnitPrice: 2_909_091,
      AmountOC: 2_909_091,
      Amount: 2_909_091,
      DiscountRate: 0,
      DiscountAmountOC: 290_909,
      DiscountAmount: 290_909,
      AmountWithoutVATOC: 2_618_182,
      AmountWithoutVAT: 2_618_182,
      VATRateName: '10%',
      VATAmountOC: 261_818,
      VATAmount: 261_818,
    });
  });

  it('signs in, publishes with server-side signing and maps the result', async () => {
    const server = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok-1', errorCode: null }),
      '/invoice': () =>
        json({
          success: true,
          publishInvoiceResult: JSON.stringify([
            {
              RefID: doc.refId,
              TransactionID: 'TX9ABC',
              InvNo: '00000012',
              InvSeries: '1C26TAA',
              InvDate: '2026-11-13T01:30:00+07:00',
              ErrorCode: null,
            },
          ]),
        }),
    });
    const misa = createMisaProvider({ ...config, fetch: server.fetch });
    const issued = await misa.issue(doc);

    expect(issued).toMatchObject({
      provider: 'misa',
      refId: doc.refId,
      invoiceNo: '00000012',
      series: '1C26TAA',
      transactionId: 'TX9ABC',
      lookupCode: 'TX9ABC',
    });
    const [auth, publish] = server.calls;
    expect(auth!.url).toBe('https://testapi.meinvoice.vn/api/integration/auth/token');
    expect(auth!.json).toEqual({
      appid: 'app-123',
      taxcode: '0109999999',
      username: 'api-user',
      password: 'secret-pass',
    });
    expect(header(publish!, 'authorization')).toBe('Bearer tok-1');
    expect(header(publish!, 'companytaxcode')).toBe('0109999999');
    expect(publish!.json).toMatchObject({ SignType: 5, PublishInvoiceData: null });
    expect((publish!.json as { InvoiceData: unknown[] }).InvoiceData).toHaveLength(1);
    expect(misa.lookupUrl(issued)).toBe('https://www.meinvoice.vn/tra-cuu/?sc=TX9ABC');
  });

  it('refreshes the token once on 401', async () => {
    let tokens = 0;
    let publishes = 0;
    const server = fixtureFetch({
      '/auth/token': () => json({ success: true, data: `tok-${++tokens}` }),
      '/invoice': () =>
        ++publishes === 1
          ? json({ success: false }, 401)
          : json({
              success: true,
              publishInvoiceResult: [{ RefID: doc.refId, TransactionID: 'T', InvNo: '7' }],
            }),
    });
    const issued = await createMisaProvider({ ...config, fetch: server.fetch }).issue(doc);
    expect(issued.invoiceNo).toBe('7');
    expect(tokens).toBe(2);
    expect(header(server.calls.at(-1)!, 'authorization')).toBe('Bearer tok-2');
  });

  it('treats DuplicateInvoiceRefID as "already issued" and returns the existing invoice', async () => {
    const server = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok' }),
      '/invoice/status': (call) => {
        expect(call.url).toContain('invoiceWithCode=true&inputType=2');
        expect(call.json).toEqual([doc.refId]);
        return json({
          success: true,
          data: JSON.stringify([
            { RefID: doc.refId, TransactionID: 'TXOLD', InvNo: '00000011', EInvoiceStatus: 1 },
          ]),
        });
      },
      '/invoice': () =>
        json({
          success: true,
          publishInvoiceResult: JSON.stringify([
            { RefID: doc.refId, ErrorCode: 'DuplicateInvoiceRefID' },
          ]),
        }),
    });
    const issued = await createMisaProvider({ ...config, fetch: server.fetch }).issue(doc);
    expect(issued).toMatchObject({ invoiceNo: '00000011', transactionId: 'TXOLD' });
  });

  it('classifies errors: business errors are permanent, outages are retryable', async () => {
    const business = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok' }),
      '/invoice': () =>
        json({
          success: true,
          publishInvoiceResult: [{ RefID: doc.refId, ErrorCode: 'InvalidTaxCode' }],
        }),
    });
    await expect(
      createMisaProvider({ ...config, fetch: business.fetch }).issue(doc),
    ).rejects.toMatchObject({ reason: 'misa:InvalidTaxCode', retryable: false });

    const down = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok' }),
      '/invoice': () => new Response('bad gateway', { status: 502 }),
    });
    await expect(
      createMisaProvider({ ...config, fetch: down.fetch }).issue(doc),
    ).rejects.toMatchObject({ reason: 'http_502', retryable: true });

    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      createMisaProvider({ ...config, fetch: offline }).issue(doc),
    ).rejects.toMatchObject({ reason: 'network_error', retryable: true });

    const badLogin = fixtureFetch({
      '/auth/token': () => json({ success: false, errorCode: 'InvalidAppID' }),
    });
    const error = await createMisaProvider({ ...config, fetch: badLogin.fetch })
      .issue(doc)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EinvoiceError);
    expect(error).toMatchObject({ reason: 'misa:auth_failed', retryable: false });
    // Errors never echo credentials.
    expect(String((error as Error).message)).not.toContain('secret-pass');
  });

  it('looks up by RefID (not found, cancelled) and cancels', async () => {
    let rows: unknown[] = [];
    const server = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok' }),
      '/invoice/status': () => json({ success: true, data: JSON.stringify(rows) }),
      '/invoice/cancel': () => json({ success: true }),
    });
    const misa = createMisaProvider({ ...config, fetch: server.fetch });
    expect(await misa.lookup(doc.refId)).toEqual({ status: 'not_found' });
    rows = [{ RefID: doc.refId, TransactionID: 'T', InvNo: '5', EInvoiceStatus: 2 }];
    const found = await misa.lookup(doc.refId);
    expect(found.status).toBe('cancelled');
    if (found.status === 'not_found') throw new Error('unreachable');
    await misa.cancel(found.invoice, 'Sai thông tin người mua');
    expect(server.calls.at(-1)!.json).toMatchObject({
      TransactionID: 'T',
      InvNo: '5',
      CancelReason: 'Sai thông tin người mua',
    });
  });

  it('issues a replacement referencing the original invoice', async () => {
    const server = fixtureFetch({
      '/auth/token': () => json({ success: true, data: 'tok' }),
      '/invoice': () =>
        json({
          success: true,
          publishInvoiceResult: [{ RefID: 'new-ref', TransactionID: 'T2', InvNo: '13' }],
        }),
    });
    const misa = createMisaProvider({ ...config, fetch: server.fetch });
    const original = {
      provider: 'misa' as const,
      refId: doc.refId,
      invoiceNo: '12',
      series: '1C26TAA',
      templateCode: '1',
      transactionId: 'T1',
      lookupCode: 'T1',
      issuedAt: new Date('2026-11-12T03:00:00Z'),
    };
    const replacement = await misa.replace(original, { ...doc, refId: 'new-ref' }, 'Thay thế');
    expect(replacement.invoiceNo).toBe('13');
    const sent = (server.calls.at(-1)!.json as { InvoiceData: Record<string, unknown>[] })
      .InvoiceData[0]!;
    expect(sent).toMatchObject({
      RefID: 'new-ref',
      ReferenceType: 1,
      OrgInvSeries: '1C26TAA',
      OrgInvNo: '12',
      OrgInvDate: '2026-11-12',
    });
  });
});

describe('Viettel S-Invoice adapter', () => {
  const config = {
    baseUrl: 'https://api-vinvoice.viettel.vn',
    username: '0109999999',
    password: 'secret-pass',
    templateCode: '1/001',
    series: 'C26TAA',
  };
  const API = '/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS';

  it('serialises the invoice to the createInvoice body', () => {
    const wire = toViettelInvoice(doc, config);
    expect(wire.generalInvoiceInfo).toMatchObject({
      invoiceType: '1',
      templateCode: '1/001',
      invoiceSeries: 'C26TAA',
      currencyCode: 'VND',
      adjustmentType: '1',
      paymentStatus: true,
      transactionUuid: doc.refId,
      invoiceIssuedDate: doc.issueDate.getTime(),
    });
    expect(wire.buyerInfo).toMatchObject({
      buyerName: 'Nguyễn Thị Hương',
      buyerLegalName: 'Công ty TNHH Hương Thơm',
      buyerTaxCode: '0312345678',
      buyerAddressLine: doc.buyer.address,
    });
    expect(wire.itemInfo[0]).toMatchObject({
      lineNumber: 1,
      selection: 1,
      itemCode: 'CED-100',
      unitPrice: 2_909_091,
      itemTotalAmountWithoutTax: 2_618_182,
      itemDiscount: 290_909,
      taxPercentage: 10,
      taxAmount: 261_818,
    });
    expect(wire.summarizeInfo).toEqual({
      sumOfTotalLineAmountWithoutTax: 2_645_455,
      totalAmountWithoutTax: 2_645_455,
      totalTaxAmount: 264_545,
      totalAmountWithTax: 2_910_000,
      totalAmountWithTaxInWords: doc.totalInWords,
      discountAmount: 290_909,
    });
    expect(wire.taxBreakdowns).toEqual([
      { taxPercentage: 10, taxableAmount: 2_645_455, taxAmount: 264_545 },
    ]);
  });

  it('logs in, creates the invoice under the seller tax code and maps the result', async () => {
    const server = fixtureFetch({
      '/auth/login': () => json({ access_token: 'vt-1', expires_in: 3600 }),
      [`${API}/createInvoice/0109999999`]: () =>
        json({
          errorCode: null,
          description: null,
          result: {
            supplierTaxCode: '0109999999',
            invoiceNo: 'C26TAA21',
            transactionID: '158000123',
            reservationCode: 'ABCD1234',
          },
        }),
    });
    const viettel = createViettelProvider({ ...config, fetch: server.fetch });
    const issued = await viettel.issue(doc);
    expect(issued).toMatchObject({
      provider: 'viettel',
      invoiceNo: 'C26TAA21',
      series: 'C26TAA',
      templateCode: '1/001',
      transactionId: '158000123',
      lookupCode: 'ABCD1234',
    });
    expect(server.calls[0]!.json).toEqual({ username: '0109999999', password: 'secret-pass' });
    expect(header(server.calls[1]!, 'authorization')).toBe('Bearer vt-1');
  });

  it('returns the first invoice when the transactionUuid was already used', async () => {
    const server = fixtureFetch({
      '/auth/login': () => json({ access_token: 'vt' }),
      [`${API}/createInvoice/0109999999`]: () =>
        json({ errorCode: 'INVOICE_DUPLICATE', description: 'duplicate', result: null }),
      [`${API}/searchInvoiceByTransactionUuid`]: (call) => {
        expect(call.json).toEqual({ supplierTaxCode: '0109999999', transactionUuid: doc.refId });
        expect(header(call, 'content-type')).toContain('application/x-www-form-urlencoded');
        return json({
          errorCode: null,
          result: [{ invoiceNo: 'C26TAA20', reservationCode: 'R1', issueDate: 1_763_000_000_000 }],
        });
      },
    });
    const issued = await createViettelProvider({ ...config, fetch: server.fetch }).issue(doc);
    expect(issued).toMatchObject({ invoiceNo: 'C26TAA20', lookupCode: 'R1' });
  });

  it('surfaces a business error as permanent when nothing was issued', async () => {
    const server = fixtureFetch({
      '/auth/login': () => json({ access_token: 'vt' }),
      [`${API}/createInvoice/0109999999`]: () =>
        json({ errorCode: 'BUYER_TAXCODE_INVALID', description: 'x', result: null }),
      [`${API}/searchInvoiceByTransactionUuid`]: () => json({ errorCode: null, result: [] }),
    });
    await expect(
      createViettelProvider({ ...config, fetch: server.fetch }).issue(doc),
    ).rejects.toMatchObject({ reason: 'viettel:BUYER_TAXCODE_INVALID', retryable: false });
  });

  it('cancels and replaces with the documented parameters', async () => {
    const server = fixtureFetch({
      '/auth/login': () => json({ access_token: 'vt' }),
      [`${API}/cancelTransactionInvoice`]: () => json({ errorCode: null }),
      [`${API}/createInvoice/0109999999`]: () =>
        json({
          errorCode: null,
          result: { invoiceNo: 'C26TAA22', transactionID: 't', reservationCode: 'r' },
        }),
    });
    const viettel = createViettelProvider({
      ...config,
      fetch: server.fetch,
      now: () => new Date('2026-11-14T03:00:00Z'),
    });
    const original = {
      provider: 'viettel' as const,
      refId: doc.refId,
      invoiceNo: 'C26TAA21',
      series: 'C26TAA',
      templateCode: '1/001',
      transactionId: 't0',
      lookupCode: 'r0',
      issuedAt: new Date('2026-11-12T03:00:00Z'),
    };
    await viettel.cancel(original, 'Huỷ');
    expect(server.calls.at(-1)!.json).toEqual({
      supplierTaxCode: '0109999999',
      invoiceNo: 'C26TAA21',
      strIssueDate: '20261112100000',
      additionalReferenceDesc: 'Huỷ',
      additionalReferenceDate: '20261114100000',
    });
    await viettel.replace(original, doc, 'Thay thế');
    expect(
      (server.calls.at(-1)!.json as { generalInvoiceInfo: Record<string, unknown> })
        .generalInvoiceInfo,
    ).toMatchObject({
      adjustmentType: '3',
      originalInvoiceId: 'C26TAA21',
      originalTemplateCode: '1/001',
    });
  });
});

describe('sandbox provider', () => {
  it('derives a stable SBX number from the refId (idempotent across restarts)', async () => {
    const a = createSandboxEinvoiceProvider();
    const b = createSandboxEinvoiceProvider();
    const first = await a.issue(doc);
    expect(first.invoiceNo).toBe(sandboxInvoiceNo(doc.refId));
    expect(first.invoiceNo).toMatch(/^SBX\d{8}$/);
    expect((await b.issue(doc)).invoiceNo).toBe(first.invoiceNo);
    expect(await a.lookup(doc.refId)).toMatchObject({ status: 'issued' });
    expect(await b.lookup('other')).toEqual({ status: 'not_found' });
  });

  it('injects failures for tests', async () => {
    const failing = createSandboxEinvoiceProvider({
      failWith: () => new EinvoiceError('timeout', true),
    });
    await expect(failing.issue(doc)).rejects.toMatchObject({ reason: 'timeout', retryable: true });
  });
});

describe('provider from env', () => {
  const prod = {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    INTERNAL_API_SECRET: 'b'.repeat(32),
  };

  it('defaults to the sandbox outside production and to none in production', () => {
    expect(createEinvoiceProvider(parseServerEnv({}))?.name).toBe('sandbox');
    expect(
      createEinvoiceProvider(parseServerEnv({ ...prod, APP_URL: 'https://shop.example.vn' })),
    ).toBeNull();
  });

  it('validates each provider’s credentials (ADR-0007: env only)', () => {
    expect(() => parseServerEnv({ EINVOICE_PROVIDER: 'misa' })).toThrow(/EINVOICE_MISA_APP_ID/);
    expect(() => parseServerEnv({ EINVOICE_PROVIDER: 'viettel' })).toThrow(
      /EINVOICE_TEMPLATE_CODE/,
    );
    const env = parseServerEnv({
      EINVOICE_PROVIDER: 'viettel',
      EINVOICE_VIETTEL_USERNAME: '0109999999',
      EINVOICE_VIETTEL_PASSWORD: 'p',
      EINVOICE_TEMPLATE_CODE: '1/001',
      EINVOICE_SERIES: 'C26TAA',
    });
    expect(createEinvoiceProvider(env)?.name).toBe('viettel');
    expect(
      createEinvoiceProvider(
        parseServerEnv({
          EINVOICE_PROVIDER: 'misa',
          EINVOICE_MISA_APP_ID: 'a',
          EINVOICE_MISA_TAX_CODE: 't',
          EINVOICE_MISA_USERNAME: 'u',
          EINVOICE_MISA_PASSWORD: 'p',
          EINVOICE_SERIES: '1C26TAA',
        }),
      )?.name,
    ).toBe('misa');
  });

  it('allows the sandbox in production builds only on localhost (E2E)', () => {
    expect(() =>
      parseServerEnv({ ...prod, APP_URL: 'https://shop.example.vn', EINVOICE_PROVIDER: 'sandbox' }),
    ).toThrow(/EINVOICE_PROVIDER/);
    expect(
      parseServerEnv({ ...prod, APP_URL: 'http://localhost:3234', EINVOICE_PROVIDER: 'sandbox' })
        .EINVOICE_PROVIDER,
    ).toBe('sandbox');
  });

  it('builds buyer lookup links from stored values', () => {
    expect(einvoiceLookupUrl('misa', 'TX 1')).toBe('https://www.meinvoice.vn/tra-cuu/?sc=TX%201');
    expect(einvoiceLookupUrl('viettel', 'R1')).toContain('viettel.vn');
    expect(einvoiceLookupUrl('sandbox', 'SBX1')).toBeNull();
    expect(einvoiceLookupUrl('misa', null)).toBeNull();
  });
});
