import type { ServerEnv } from '@/lib/env';

import { createMisaProvider, MISA_LOOKUP_URL as MISA_LOOKUP_URL_VALUE } from './misa';
import { createSandboxEinvoiceProvider } from './sandbox';
import type { EinvoiceProvider, EinvoiceProviderName, FetchLike } from './types';
import { createViettelProvider, VIETTEL_LOOKUP_URL as VIETTEL_LOOKUP_URL_VALUE } from './viettel';

/*
 * Provider chosen by env (D13, ADR-0007: credentials only in env). Outside production the
 * default is the sandbox; in production an unset EINVOICE_PROVIDER returns `null` (the job then
 * fails with `not_configured` and alerts staff). env.ts validates each provider's credentials.
 */

export type EinvoiceEnv = Pick<
  ServerEnv,
  | 'NODE_ENV'
  | 'EINVOICE_PROVIDER'
  | 'EINVOICE_TEMPLATE_CODE'
  | 'EINVOICE_SERIES'
  | 'EINVOICE_MISA_BASE_URL'
  | 'EINVOICE_MISA_APP_ID'
  | 'EINVOICE_MISA_TAX_CODE'
  | 'EINVOICE_MISA_USERNAME'
  | 'EINVOICE_MISA_PASSWORD'
  | 'EINVOICE_VIETTEL_BASE_URL'
  | 'EINVOICE_VIETTEL_USERNAME'
  | 'EINVOICE_VIETTEL_PASSWORD'
>;

export function einvoiceProviderName(env: EinvoiceEnv): EinvoiceProviderName | null {
  return env.EINVOICE_PROVIDER ?? (env.NODE_ENV === 'production' ? null : 'sandbox');
}

export function createEinvoiceProvider(
  env: EinvoiceEnv,
  options: { fetch?: FetchLike } = {},
): EinvoiceProvider | null {
  switch (einvoiceProviderName(env)) {
    case 'misa':
      return createMisaProvider({
        baseUrl: env.EINVOICE_MISA_BASE_URL,
        appId: env.EINVOICE_MISA_APP_ID!,
        taxCode: env.EINVOICE_MISA_TAX_CODE!,
        username: env.EINVOICE_MISA_USERNAME!,
        password: env.EINVOICE_MISA_PASSWORD!,
        series: env.EINVOICE_SERIES!,
        templateCode: env.EINVOICE_TEMPLATE_CODE ?? null,
        fetch: options.fetch,
      });
    case 'viettel':
      return createViettelProvider({
        baseUrl: env.EINVOICE_VIETTEL_BASE_URL,
        username: env.EINVOICE_VIETTEL_USERNAME!,
        password: env.EINVOICE_VIETTEL_PASSWORD!,
        templateCode: env.EINVOICE_TEMPLATE_CODE!,
        series: env.EINVOICE_SERIES!,
        fetch: options.fetch,
      });
    case 'sandbox':
      return createSandboxEinvoiceProvider({
        series: env.EINVOICE_SERIES,
        templateCode: env.EINVOICE_TEMPLATE_CODE,
      });
    default:
      return null;
  }
}

export { createMisaProvider, MISA_LOOKUP_URL, toMisaInvoice } from './misa';
export { createSandboxEinvoiceProvider, sandboxInvoiceNo } from './sandbox';
export { createViettelProvider, toViettelInvoice, VIETTEL_LOOKUP_URL } from './viettel';
export {
  EinvoiceError,
  type EinvoiceBuyer,
  type EinvoiceDocument,
  type EinvoiceLine,
  type EinvoiceLookup,
  type EinvoiceProvider,
  type EinvoiceProviderName,
  type EinvoiceTaxBreakdown,
  type IssuedEinvoice,
} from './types';

/** Buyer lookup page of an issued invoice, from the stored provider name and lookup code. */
export function einvoiceLookupUrl(
  provider: string | null,
  lookupCode: string | null,
): string | null {
  if (!lookupCode) return null;
  if (provider === 'misa') return `${MISA_LOOKUP_URL_VALUE}?sc=${encodeURIComponent(lookupCode)}`;
  if (provider === 'viettel') return VIETTEL_LOOKUP_URL_VALUE;
  return null;
}
