import { isRecord, parseMaybeJsonArray, safeCode, sendJson, vnDate } from './http';
import {
  EinvoiceError,
  type EinvoiceDocument,
  type EinvoiceLookup,
  type EinvoiceProvider,
  type FetchLike,
  type IssuedEinvoice,
} from './types';

/*
 * MISA meInvoice integration API ("tích hợp sâu", doc.meinvoice.vn), server-side signing:
 * - `POST {base}/auth/token` {appid, taxcode, username, password} → { success, data: token };
 * - `POST {base}/invoice` {SignType, InvoiceData: [...], PublishInvoiceData} with
 *   `Authorization: Bearer` + `CompanyTaxCode` → { success, publishInvoiceResult: "[...]" };
 * - `POST {base}/invoice/status?invoiceWithCode=…&inputType=2` [RefID] → { data: "[...]" };
 * - `POST {base}/invoice/cancel` {TransactionID, InvNo, RefDate, CancelReason}.
 * `RefID` = our order id, so `DuplicateInvoiceRefID` means "already issued" (looked up).
 * Field names follow the published contract; confirm them in the MISA test environment while
 * onboarding (accountant + provider, ADR-0013).
 */

export type MisaConfig = {
  baseUrl: string;
  appId: string;
  taxCode: string;
  username: string;
  password: string;
  /** Invoice series ("ký hiệu"), e.g. `1C26TAA` (C = with tax authority code). */
  series: string;
  /** Invoice template number ("mẫu số"), default `1` (VAT invoice). */
  templateCode?: string | null;
  fetch?: FetchLike;
  now?: () => Date;
};

/** SignType 5: MISA signs with the seller's HSM/cloud certificate (no client-side signing). */
export const MISA_SIGN_TYPE = 5;
/** Tokens are long-lived; refresh hourly (and on any 401). */
const TOKEN_TTL_MS = 60 * 60 * 1000;
const DUPLICATE_CODES = new Set(['DuplicateInvoiceRefID', 'InvoiceDuplicated']);
/** MISA EInvoiceStatus: 2 = cancelled, 5/7 = replaced (others: issued / adjusted). */
const CANCELLED_STATUSES = new Set([2]);
const REPLACED_STATUSES = new Set([5, 7]);

export const MISA_LOOKUP_URL = 'https://www.meinvoice.vn/tra-cuu/';

function withCode(series: string): boolean {
  return series.charAt(1).toUpperCase() === 'C';
}

/** Serialises the document to MISA's `OriginalInvoiceData` shape (pure, unit-tested). */
export function toMisaInvoice(doc: EinvoiceDocument, config: Pick<MisaConfig, 'series'>) {
  const buyer = doc.buyer;
  return {
    RefID: doc.refId,
    InvSeries: config.series,
    InvDate: vnDate(doc.issueDate),
    CurrencyCode: doc.currency,
    ExchangeRate: 1,
    PaymentMethodName: doc.paymentMethodName,
    IsInvoiceSummary: false,
    IsSendEmail: Boolean(buyer.email),
    ReceiverEmail: buyer.email ?? undefined,
    ReceiverName: buyer.name,
    BuyerCode: undefined,
    BuyerLegalName: buyer.kind === 'company' ? (buyer.legalName ?? buyer.name) : '',
    BuyerFullName: buyer.name,
    BuyerTaxCode: buyer.taxCode ?? '',
    BuyerAddress: buyer.address,
    BuyerEmail: buyer.email ?? '',
    BuyerPhoneNumber: buyer.phone ?? '',
    TotalSaleAmountOC: doc.totals.amountNet,
    TotalSaleAmount: doc.totals.amountNet,
    TotalDiscountAmountOC: doc.totals.discountNet,
    TotalDiscountAmount: doc.totals.discountNet,
    TotalAmountWithoutVATOC: doc.totals.taxableAmount,
    TotalAmountWithoutVAT: doc.totals.taxableAmount,
    TotalVATAmountOC: doc.totals.vatAmount,
    TotalVATAmount: doc.totals.vatAmount,
    TotalAmountOC: doc.totals.grossAmount,
    TotalAmount: doc.totals.grossAmount,
    TotalAmountInWords: doc.totalInWords,
    OriginalInvoiceDetail: doc.lines.map((line) => ({
      ItemType: 1,
      LineNumber: line.lineNumber,
      SortOrder: line.lineNumber,
      ItemCode: line.code ?? '',
      ItemName: line.name,
      UnitName: line.unitName,
      Quantity: line.quantity,
      UnitPrice: line.unitPriceNet,
      AmountOC: line.amountNet,
      Amount: line.amountNet,
      DiscountRate: 0,
      DiscountAmountOC: line.discountNet,
      DiscountAmount: line.discountNet,
      AmountWithoutVATOC: line.taxableAmount,
      AmountWithoutVAT: line.taxableAmount,
      VATRateName: `${line.vatRate}%`,
      VATAmountOC: line.vatAmount,
      VATAmount: line.vatAmount,
    })),
    TaxRateInfo: doc.taxBreakdown.map((tax) => ({
      VATRateName: `${tax.vatRate}%`,
      AmountWithoutVATOC: tax.taxableAmount,
      VATAmountOC: tax.vatAmount,
    })),
    OptionUserDefined: {
      MainCurrency: 'VND',
      AmountDecimalDigits: '0',
      AmountOCDecimalDigits: '0',
      UnitPriceDecimalDigits: '0',
      UnitPriceOCDecimalDigits: '0',
      QuantityDecimalDigits: '0',
      CoefficientDecimalDigits: '2',
      ExchangRateDecimalDigits: '0',
    },
    InvoiceNote: doc.note,
  };
}

function envelopeError(body: unknown, fallback: string): EinvoiceError {
  const record = isRecord(body) ? body : {};
  const code = safeCode(record.errorCode) ?? safeCode(record.ErrorCode) ?? fallback;
  return new EinvoiceError(`misa:${code}`, false);
}

export function createMisaProvider(config: MisaConfig): EinvoiceProvider {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  const now = config.now ?? (() => new Date());
  const templateCode = config.templateCode ?? '1';
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt > now().getTime()) return token.value;
    const response = await sendJson(doFetch, {
      url: `${base}/auth/token`,
      json: {
        appid: config.appId,
        taxcode: config.taxCode,
        username: config.username,
        password: config.password,
      },
    });
    const body = isRecord(response.body) ? response.body : {};
    if (response.status !== 200 || body.success !== true || typeof body.data !== 'string') {
      throw new EinvoiceError('misa:auth_failed', false);
    }
    token = { value: body.data, expiresAt: now().getTime() + TOKEN_TTL_MS };
    return token.value;
  }

  /** Authenticated call; a 401 refreshes the token once. */
  async function call(path: string, json: unknown) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await sendJson(doFetch, {
        url: `${base}${path}`,
        headers: {
          authorization: `Bearer ${await getToken(attempt > 0)}`,
          companytaxcode: config.taxCode,
        },
        json,
      });
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 401) throw new EinvoiceError('misa:auth_failed', false);
      if (response.status >= 400) throw envelopeError(response.body, `http_${response.status}`);
      return isRecord(response.body) ? response.body : {};
    }
  }

  function fromResult(row: Record<string, unknown>, fallbackRefId: string): IssuedEinvoice {
    const transactionId = typeof row.TransactionID === 'string' ? row.TransactionID : null;
    const invDate = typeof row.InvDate === 'string' ? new Date(row.InvDate) : null;
    return {
      provider: 'misa',
      refId: typeof row.RefID === 'string' ? row.RefID : fallbackRefId,
      invoiceNo: String(row.InvNo ?? ''),
      series: typeof row.InvSeries === 'string' && row.InvSeries ? row.InvSeries : config.series,
      templateCode,
      transactionId,
      lookupCode: transactionId,
      issuedAt: invDate && !Number.isNaN(invDate.getTime()) ? invDate : now(),
    };
  }

  async function publish(payload: Record<string, unknown>, refId: string) {
    const body = await call(`/invoice`, {
      SignType: MISA_SIGN_TYPE,
      InvoiceData: [payload],
      PublishInvoiceData: null,
    });
    const [result] = parseMaybeJsonArray(body.publishInvoiceResult);
    const code = safeCode(result?.ErrorCode) ?? (body.success === true ? null : 'publish_failed');
    if (code && DUPLICATE_CODES.has(code)) return null;
    if (code || !result || !result.InvNo) {
      throw code ? new EinvoiceError(`misa:${code}`, false) : envelopeError(body, 'no_result');
    }
    return fromResult(result, refId);
  }

  const provider: EinvoiceProvider = {
    name: 'misa',
    async issue(doc) {
      const issued = await publish(toMisaInvoice(doc, config), doc.refId);
      if (issued) return issued;
      // Already issued for this RefID (earlier attempt): return that invoice.
      const found = await provider.lookup(doc.refId);
      if (found.status === 'not_found') throw new EinvoiceError('misa:duplicate_not_found', true);
      return found.invoice;
    },
    async lookup(refId) {
      const query = `invoiceWithCode=${withCode(config.series)}&inputType=2`;
      const body = await call(`/invoice/status?${query}`, [refId]);
      if (body.success !== true) throw envelopeError(body, 'status_failed');
      const row = parseMaybeJsonArray(body.data).find((r) => r.RefID === refId);
      if (!row || !row.InvNo) return { status: 'not_found' } satisfies EinvoiceLookup;
      const status = Number(row.EInvoiceStatus);
      return {
        status: CANCELLED_STATUSES.has(status)
          ? 'cancelled'
          : REPLACED_STATUSES.has(status)
            ? 'replaced'
            : 'issued',
        invoice: fromResult(row, refId),
        providerStatus: Number.isFinite(status) ? String(status) : null,
      };
    },
    async cancel(invoice, reason) {
      const body = await call(`/invoice/cancel`, {
        TransactionID: invoice.transactionId,
        InvNo: invoice.invoiceNo,
        RefDate: vnDate(invoice.issuedAt),
        CancelReason: reason,
      });
      if (body.success !== true) throw envelopeError(body, 'cancel_failed');
    },
    async replace(original, doc, reason) {
      const payload = {
        ...toMisaInvoice(doc, config),
        ReferenceType: 1,
        OrgInvoiceType: 1,
        OrgInvTemplateNo: original.templateCode ?? templateCode,
        OrgInvSeries: original.series,
        OrgInvNo: original.invoiceNo,
        OrgInvDate: vnDate(original.issuedAt),
        InvoiceNote: reason,
      };
      const issued = await publish(payload, doc.refId);
      if (!issued) throw new EinvoiceError('misa:DuplicateInvoiceRefID', false);
      return issued;
    },
    lookupUrl(invoice) {
      return invoice.lookupCode
        ? `${MISA_LOOKUP_URL}?sc=${encodeURIComponent(invoice.lookupCode)}`
        : null;
    },
  };
  return provider;
}
