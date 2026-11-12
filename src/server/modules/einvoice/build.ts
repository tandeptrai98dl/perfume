import type {
  EinvoiceBuyer,
  EinvoiceDocument,
  EinvoiceLine,
  EinvoiceTaxBreakdown,
} from '@/server/integrations/einvoice';

import { amountInWords, type AmountWordsLexicon } from './amount-in-words';

/*
 * Builds the provider-neutral invoice from the order snapshot (pure; D13). Prices in the shop
 * are VAT-inclusive, so each line's paid amount (`order_items.line_total`, after its share of
 * the coupon) is split into taxable amount + VAT at the configured rate:
 *   taxable = round(gross × 100 / (100 + rate)), vat = gross − taxable.
 * The gross amounts add up exactly to the order total (checked), so the invoice total always
 * equals what the customer paid. Shipping and gift-wrap fees are service lines at the same rate.
 * VAT rate and rounding per line are PENDING ACCOUNTANT CONFIRMATION (ADR-0013).
 */

export type InvoiceOrder = {
  id: string;
  code: string;
  customerName: string;
  email: string;
  phone: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  giftWrapFee: number;
  total: number;
  vatInvoice: unknown;
};

export type InvoiceOrderItem = {
  sku: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  discountAllocated: number;
  lineTotal: number;
};

export type InvoiceLabels = {
  unitGoods: string;
  unitService: string;
  shipping: string;
  giftWrap: string;
  paymentMethod: string;
  note: (code: string) => string;
  words: AmountWordsLexicon;
};

export class InvoiceBuildError extends Error {
  constructor(public readonly reason: 'totals_mismatch' | 'invalid_amount') {
    super(reason);
    this.name = 'InvoiceBuildError';
  }
}

/** Taxable part of a VAT-inclusive amount (integer đồng, half up). */
export function taxableOf(gross: number, vatRate: number): number {
  return Math.round((gross * 100) / (100 + vatRate));
}

type CompanyDetails = {
  companyName?: unknown;
  taxCode?: unknown;
  address?: unknown;
  email?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function invoiceBuyer(order: InvoiceOrder, shippingAddress: string | null): EinvoiceBuyer {
  const vat = (order.vatInvoice ?? null) as CompanyDetails | null;
  const taxCode = vat ? text(vat.taxCode) : null;
  const companyName = vat ? text(vat.companyName) : null;
  if (vat && taxCode && companyName) {
    return {
      kind: 'company',
      name: order.customerName,
      legalName: companyName,
      taxCode,
      address: text(vat.address) ?? shippingAddress ?? '',
      email: text(vat.email) ?? text(order.email),
      phone: text(order.phone),
    };
  }
  return {
    kind: 'individual',
    name: order.customerName,
    legalName: null,
    taxCode: null,
    address: shippingAddress ?? '',
    // Manual orders may have no e-mail (stored as '').
    email: text(order.email),
    phone: text(order.phone),
  };
}

function line(
  input: {
    lineNumber: number;
    kind: EinvoiceLine['kind'];
    code: string | null;
    name: string;
    unitName: string;
    quantity: number;
    /** Before the discount, VAT included. */
    grossBeforeDiscount: number;
    gross: number;
  },
  vatRate: number,
): EinvoiceLine {
  if (
    !Number.isSafeInteger(input.gross) ||
    !Number.isSafeInteger(input.grossBeforeDiscount) ||
    input.gross < 0 ||
    input.quantity <= 0
  ) {
    throw new InvoiceBuildError('invalid_amount');
  }
  const taxableAmount = taxableOf(input.gross, vatRate);
  const amountNet = Math.max(taxableOf(input.grossBeforeDiscount, vatRate), taxableAmount);
  return {
    lineNumber: input.lineNumber,
    kind: input.kind,
    code: input.code,
    name: input.name,
    unitName: input.unitName,
    quantity: input.quantity,
    unitPriceNet: Math.round(amountNet / input.quantity),
    amountNet,
    discountNet: amountNet - taxableAmount,
    taxableAmount,
    vatRate,
    vatAmount: input.gross - taxableAmount,
    grossAmount: input.gross,
  };
}

export function buildEinvoiceDocument(input: {
  order: InvoiceOrder;
  items: InvoiceOrderItem[];
  shippingAddress: string | null;
  vatRatePercent: number;
  issueDate: Date;
  labels: InvoiceLabels;
}): EinvoiceDocument {
  const { order, labels, vatRatePercent: rate } = input;
  const lines: EinvoiceLine[] = [];
  for (const item of input.items) {
    lines.push(
      line(
        {
          lineNumber: lines.length + 1,
          kind: 'goods',
          code: item.sku,
          name: `${item.productName} ${item.variantLabel}`.trim(),
          unitName: labels.unitGoods,
          quantity: item.quantity,
          grossBeforeDiscount: item.unitPrice * item.quantity,
          gross: item.lineTotal,
        },
        rate,
      ),
    );
  }
  const fees: [number, string][] = [
    [order.shippingFee, labels.shipping],
    [order.giftWrapFee, labels.giftWrap],
  ];
  for (const [amount, name] of fees) {
    if (amount <= 0) continue;
    lines.push(
      line(
        {
          lineNumber: lines.length + 1,
          kind: 'service',
          code: null,
          name,
          unitName: labels.unitService,
          quantity: 1,
          grossBeforeDiscount: amount,
          gross: amount,
        },
        rate,
      ),
    );
  }

  const sum = (pick: (l: EinvoiceLine) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const grossAmount = sum((l) => l.grossAmount);
  if (grossAmount !== order.total) throw new InvoiceBuildError('totals_mismatch');

  const byRate = new Map<number, EinvoiceTaxBreakdown>();
  for (const l of lines) {
    const entry = byRate.get(l.vatRate) ?? { vatRate: l.vatRate, taxableAmount: 0, vatAmount: 0 };
    entry.taxableAmount += l.taxableAmount;
    entry.vatAmount += l.vatAmount;
    byRate.set(l.vatRate, entry);
  }

  return {
    refId: order.id,
    orderCode: order.code,
    issueDate: input.issueDate,
    currency: 'VND',
    paymentMethodName: labels.paymentMethod,
    buyer: invoiceBuyer(order, input.shippingAddress),
    lines,
    taxBreakdown: [...byRate.values()],
    totals: {
      amountNet: sum((l) => l.amountNet),
      discountNet: sum((l) => l.discountNet),
      taxableAmount: sum((l) => l.taxableAmount),
      vatAmount: sum((l) => l.vatAmount),
      grossAmount,
    },
    totalInWords: amountInWords(grossAmount, labels.words),
    note: labels.note(order.code),
  };
}
