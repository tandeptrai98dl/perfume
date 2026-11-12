/*
 * E-invoice adapter contract (D13, ADR-0013). The einvoice module builds one provider-neutral
 * `EinvoiceDocument` from the order snapshot; each adapter (MISA meInvoice, Viettel S-Invoice,
 * sandbox) serialises it to its provider's API. Amounts are integer VND (whole đồng).
 *
 * Idempotency: `refId` (the order id) is sent as the provider's own client reference
 * (MISA `RefID`, Viettel `transactionUuid`), so a retry can look the invoice up instead of
 * issuing a second one.
 */

export type EinvoiceProviderName = 'sandbox' | 'misa' | 'viettel';

export type EinvoiceBuyer = {
  kind: 'company' | 'individual';
  /** Person who bought (customer name). */
  name: string;
  /** Company legal name (company invoices only). */
  legalName: string | null;
  taxCode: string | null;
  address: string;
  email: string | null;
  phone: string | null;
};

export type EinvoiceLine = {
  lineNumber: number;
  kind: 'goods' | 'service';
  /** SKU for goods, null for fees. */
  code: string | null;
  name: string;
  unitName: string;
  quantity: number;
  /** Unit price before VAT (rounded to whole đồng; `amountNet` is authoritative). */
  unitPriceNet: number;
  /** quantity × price before VAT and before the discount. */
  amountNet: number;
  /** Discount before VAT. */
  discountNet: number;
  /** amountNet − discountNet: the taxable amount. */
  taxableAmount: number;
  /** VAT rate in percent (0, 5, 8, 10). */
  vatRate: number;
  vatAmount: number;
  /** What the buyer paid for this line (VAT included) = taxableAmount + vatAmount. */
  grossAmount: number;
};

export type EinvoiceTaxBreakdown = { vatRate: number; taxableAmount: number; vatAmount: number };

export type EinvoiceDocument = {
  /** Idempotency key sent to the provider (the order id). */
  refId: string;
  orderCode: string;
  issueDate: Date;
  currency: 'VND';
  /** Payment method label printed on the invoice (e.g. "TM/CK"). */
  paymentMethodName: string;
  buyer: EinvoiceBuyer;
  lines: EinvoiceLine[];
  taxBreakdown: EinvoiceTaxBreakdown[];
  totals: {
    /** Sum of `amountNet` (before discount and VAT). */
    amountNet: number;
    discountNet: number;
    taxableAmount: number;
    vatAmount: number;
    /** Equals the order total. */
    grossAmount: number;
  };
  /** Total in Vietnamese words ("Một triệu ... đồng"). */
  totalInWords: string;
  /** Free text printed on the invoice (the order code). */
  note: string;
};

export type IssuedEinvoice = {
  provider: EinvoiceProviderName;
  refId: string;
  invoiceNo: string;
  series: string;
  templateCode: string | null;
  /** Provider transaction id (MISA TransactionID, Viettel transactionID). */
  transactionId: string | null;
  /** Code the buyer uses on the provider's lookup portal (MISA TransactionID, Viettel reservation code). */
  lookupCode: string | null;
  issuedAt: Date;
};

export type EinvoiceLookup =
  | {
      status: 'issued' | 'cancelled' | 'replaced';
      invoice: IssuedEinvoice;
      providerStatus: string | null;
    }
  | { status: 'not_found' };

export interface EinvoiceProvider {
  readonly name: EinvoiceProviderName;
  /** Issues (creates + signs + publishes) the invoice. */
  issue(document: EinvoiceDocument): Promise<IssuedEinvoice>;
  /** Looks an invoice up by our `refId` (status check and duplicate guard). */
  lookup(refId: string): Promise<EinvoiceLookup>;
  /** Cancels an issued invoice (only allowed in the cases the law permits; manual use). */
  cancel(invoice: IssuedEinvoice, reason: string): Promise<void>;
  /** Issues a replacement invoice for `original` (Decree 123/2020 replacement). */
  replace(
    original: IssuedEinvoice,
    document: EinvoiceDocument,
    reason: string,
  ): Promise<IssuedEinvoice>;
  /** Public lookup page for the buyer, when the provider has one. */
  lookupUrl(invoice: Pick<IssuedEinvoice, 'lookupCode'>): string | null;
}

/**
 * Provider failure. `retryable` = transient (network, timeout, 5xx, 429): the job retries with
 * backoff. Anything else (validation, credentials, configuration) fails at once and alerts staff.
 * `reason` is a short machine code; it never contains buyer data or secrets.
 */
export class EinvoiceError extends Error {
  constructor(
    public readonly reason: string,
    public readonly retryable: boolean,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'EinvoiceError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
