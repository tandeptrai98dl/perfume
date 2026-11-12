import { isRecord, safeCode, sendJson, vnCompact } from './http';
import {
  EinvoiceError,
  type EinvoiceDocument,
  type EinvoiceLookup,
  type EinvoiceProvider,
  type FetchLike,
  type IssuedEinvoice,
} from './types';

/*
 * Viettel S-Invoice API (sinvoice.viettel.vn, "InvoiceAPI"):
 * - `POST {base}/auth/login` {username, password} → { access_token };
 * - `POST {base}/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS/createInvoice/{taxCode}`
 *   { generalInvoiceInfo, buyerInfo, payments, itemInfo, summarizeInfo, taxBreakdowns }
 *   → { errorCode, description, result: { invoiceNo, transactionID, reservationCode } };
 * - `POST …/InvoiceWS/searchInvoiceByTransactionUuid` (form: supplierTaxCode, transactionUuid);
 * - `POST …/InvoiceWS/cancelTransactionInvoice` (form: supplierTaxCode, invoiceNo, strIssueDate,
 *   additionalReferenceDesc, additionalReferenceDate).
 * `transactionUuid` = our order id: Viettel refuses a second invoice for the same uuid, and the
 * search finds the first one. Confirm field names in the Viettel test account while onboarding.
 */

export type ViettelConfig = {
  baseUrl: string;
  /** Seller tax code (the API username). */
  username: string;
  password: string;
  /** Template ("mẫu số"), e.g. `1/001`, and series ("ký hiệu"), e.g. `C26TAA`. */
  templateCode: string;
  series: string;
  fetch?: FetchLike;
  now?: () => Date;
};

const TOKEN_TTL_MS = 30 * 60 * 1000;
const API = '/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS';

export const VIETTEL_LOOKUP_URL = 'https://vinvoice.viettel.vn/utilities/invoice-search';

/** Serialises the document to Viettel's `createInvoice` body (pure, unit-tested). */
export function toViettelInvoice(
  doc: EinvoiceDocument,
  config: Pick<ViettelConfig, 'templateCode' | 'series'>,
) {
  const buyer = doc.buyer;
  return {
    generalInvoiceInfo: {
      invoiceType: '1',
      templateCode: config.templateCode,
      invoiceSeries: config.series,
      currencyCode: doc.currency,
      exchangeRate: 1,
      adjustmentType: '1',
      paymentStatus: true,
      cusGetInvoiceRight: true,
      invoiceIssuedDate: doc.issueDate.getTime(),
      transactionUuid: doc.refId,
      invoiceNote: doc.note,
    },
    buyerInfo: {
      buyerName: buyer.name,
      buyerLegalName: buyer.kind === 'company' ? (buyer.legalName ?? buyer.name) : undefined,
      buyerTaxCode: buyer.taxCode ?? undefined,
      buyerAddressLine: buyer.address,
      buyerEmail: buyer.email ?? undefined,
      buyerPhoneNumber: buyer.phone ?? undefined,
      buyerCountryCode: 'VN',
    },
    payments: [{ paymentMethodName: doc.paymentMethodName }],
    itemInfo: doc.lines.map((line) => ({
      lineNumber: line.lineNumber,
      selection: 1,
      itemCode: line.code ?? undefined,
      itemName: line.name,
      unitName: line.unitName,
      quantity: line.quantity,
      unitPrice: line.unitPriceNet,
      itemTotalAmountWithoutTax: line.taxableAmount,
      itemTotalAmountAfterDiscount: line.taxableAmount,
      itemTotalAmountWithTax: line.grossAmount,
      itemDiscount: line.discountNet,
      taxPercentage: line.vatRate,
      taxAmount: line.vatAmount,
    })),
    summarizeInfo: {
      sumOfTotalLineAmountWithoutTax: doc.totals.taxableAmount,
      totalAmountWithoutTax: doc.totals.taxableAmount,
      totalTaxAmount: doc.totals.vatAmount,
      totalAmountWithTax: doc.totals.grossAmount,
      totalAmountWithTaxInWords: doc.totalInWords,
      discountAmount: doc.totals.discountNet,
    },
    taxBreakdowns: doc.taxBreakdown.map((tax) => ({
      taxPercentage: tax.vatRate,
      taxableAmount: tax.taxableAmount,
      taxAmount: tax.vatAmount,
    })),
  };
}

function businessError(body: Record<string, unknown>, fallback: string): EinvoiceError {
  return new EinvoiceError(`viettel:${safeCode(body.errorCode) ?? fallback}`, false);
}

export function createViettelProvider(config: ViettelConfig): EinvoiceProvider {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  const now = config.now ?? (() => new Date());
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt > now().getTime()) return token.value;
    const response = await sendJson(doFetch, {
      url: `${base}/auth/login`,
      json: { username: config.username, password: config.password },
    });
    const body = isRecord(response.body) ? response.body : {};
    if (response.status !== 200 || typeof body.access_token !== 'string') {
      throw new EinvoiceError('viettel:auth_failed', false);
    }
    const ttl = typeof body.expires_in === 'number' ? body.expires_in * 1000 : TOKEN_TTL_MS;
    token = { value: body.access_token, expiresAt: now().getTime() + Math.min(ttl, TOKEN_TTL_MS) };
    return token.value;
  }

  async function call(path: string, payload: { json?: unknown; form?: Record<string, string> }) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await sendJson(doFetch, {
        url: `${base}${path}`,
        headers: { authorization: `Bearer ${await getToken(attempt > 0)}` },
        ...payload,
      });
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 401) throw new EinvoiceError('viettel:auth_failed', false);
      const body = isRecord(response.body) ? response.body : {};
      if (response.status >= 400) throw businessError(body, `http_${response.status}`);
      return body;
    }
  }

  function issuedFrom(result: Record<string, unknown>, refId: string, issuedAt: Date) {
    return {
      provider: 'viettel',
      refId,
      invoiceNo: String(result.invoiceNo ?? ''),
      series: config.series,
      templateCode: config.templateCode,
      transactionId: typeof result.transactionID === 'string' ? result.transactionID : null,
      lookupCode: typeof result.reservationCode === 'string' ? result.reservationCode : null,
      issuedAt,
    } satisfies IssuedEinvoice;
  }

  async function create(body: unknown, refId: string, issuedAt: Date) {
    const response = await call(`${API}/createInvoice/${encodeURIComponent(config.username)}`, {
      json: body,
    });
    const result = isRecord(response.result) ? response.result : null;
    if (response.errorCode || !result?.invoiceNo)
      return { error: businessError(response, 'no_result') };
    return { issued: issuedFrom(result, refId, issuedAt) };
  }

  const provider: EinvoiceProvider = {
    name: 'viettel',
    async issue(doc) {
      const outcome = await create(toViettelInvoice(doc, config), doc.refId, doc.issueDate);
      if (outcome.issued) return outcome.issued;
      // A refused duplicate transactionUuid: the first attempt went through.
      const found = await provider.lookup(doc.refId);
      if (found.status !== 'not_found') return found.invoice;
      throw outcome.error;
    },
    async lookup(refId) {
      const body = await call(`${API}/searchInvoiceByTransactionUuid`, {
        form: { supplierTaxCode: config.username, transactionUuid: refId },
      });
      const rows = Array.isArray(body.result) ? body.result.filter(isRecord) : [];
      const row = rows.find((r) => r.invoiceNo);
      if (!row) return { status: 'not_found' } satisfies EinvoiceLookup;
      const issueDate = typeof row.issueDate === 'number' ? new Date(row.issueDate) : now();
      return {
        status: 'issued',
        invoice: issuedFrom(row, refId, issueDate),
        providerStatus: safeCode(row.status),
      };
    },
    async cancel(invoice, reason) {
      const body = await call(`${API}/cancelTransactionInvoice`, {
        form: {
          supplierTaxCode: config.username,
          invoiceNo: invoice.invoiceNo,
          strIssueDate: vnCompact(invoice.issuedAt),
          additionalReferenceDesc: reason,
          additionalReferenceDate: vnCompact(now()),
        },
      });
      if (body.errorCode) throw businessError(body, 'cancel_failed');
    },
    async replace(original, doc, reason) {
      const payload = toViettelInvoice(doc, config);
      const body = {
        ...payload,
        generalInvoiceInfo: {
          ...payload.generalInvoiceInfo,
          adjustmentType: '3',
          originalInvoiceId: original.invoiceNo,
          originalInvoiceIssueDate: original.issuedAt.getTime(),
          originalTemplateCode: original.templateCode ?? config.templateCode,
          additionalReferenceDesc: reason,
          additionalReferenceDate: now().getTime(),
        },
      };
      const outcome = await create(body, doc.refId, doc.issueDate);
      if (outcome.issued) return outcome.issued;
      throw outcome.error;
    },
    lookupUrl(invoice) {
      return invoice.lookupCode ? VIETTEL_LOOKUP_URL : null;
    },
  };
  return provider;
}
