import { createHash } from 'node:crypto';

import {
  EinvoiceError,
  type EinvoiceDocument,
  type EinvoiceProvider,
  type IssuedEinvoice,
} from './types';

/*
 * Sandbox provider for development and E2E (no network). Invoice numbers are derived from the
 * refId, so issuing the same order twice returns the same number even across restarts.
 * Numbers start with `SBX` so nobody mistakes them for real invoices. `failWith` injects
 * failures for tests and demos.
 */

export type SandboxConfig = {
  series?: string;
  templateCode?: string;
  now?: () => Date;
  /** Return an error to fail this call (tests); null to succeed. `null` document = cancel. */
  failWith?: (document: EinvoiceDocument | null) => EinvoiceError | null;
};

export function sandboxInvoiceNo(refId: string): string {
  const digest = createHash('sha256').update(refId).digest();
  return `SBX${String(digest.readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;
}

export function createSandboxEinvoiceProvider(config: SandboxConfig = {}): EinvoiceProvider {
  const now = config.now ?? (() => new Date());
  const series = config.series ?? 'C26SBX';
  const templateCode = config.templateCode ?? '1';
  const issued = new Map<string, IssuedEinvoice & { state: 'issued' | 'cancelled' | 'replaced' }>();

  function make(refId: string): IssuedEinvoice {
    const invoiceNo = sandboxInvoiceNo(refId);
    return {
      provider: 'sandbox',
      refId,
      invoiceNo,
      series,
      templateCode,
      transactionId: `SBX-${refId}`,
      lookupCode: invoiceNo,
      issuedAt: now(),
    };
  }

  return {
    name: 'sandbox',
    async issue(document) {
      const failure = config.failWith?.(document);
      if (failure) throw failure;
      const existing = issued.get(document.refId);
      if (existing) return existing;
      const invoice = make(document.refId);
      issued.set(document.refId, { ...invoice, state: 'issued' });
      return invoice;
    },
    async lookup(refId) {
      const found = issued.get(refId);
      if (!found) return { status: 'not_found' };
      const { state, ...invoice } = found;
      return { status: state, invoice, providerStatus: state };
    },
    async cancel(invoice) {
      const failure = config.failWith?.(null);
      if (failure) throw failure;
      // Sandbox memory does not survive a worker restart: an invoice issued by an earlier
      // process is accepted as known (numbers are derived from the refId anyway).
      const found = issued.get(invoice.refId) ?? { ...invoice, state: 'issued' as const };
      issued.set(invoice.refId, { ...found, state: 'cancelled' });
    },
    async replace(original, document) {
      const failure = config.failWith?.(document);
      if (failure) throw failure;
      const found = issued.get(original.refId);
      if (found) found.state = 'replaced';
      const invoice = make(document.refId);
      issued.set(document.refId, { ...invoice, state: 'issued' });
      return invoice;
    },
    lookupUrl() {
      return null;
    },
  };
}
