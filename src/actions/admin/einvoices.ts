'use server';

import 'server-only';

import { einvoiceRetrySchema, retryEinvoice } from '@/server/modules/einvoice';

import { runAdminAction } from './run';

/*
 * E-invoices (D13): staff retry a failed (or never started) invoice of a delivered order from
 * the order page or the failed list. `orders.process` (Owner, Manager, Staff); idempotent —
 * the job checks the provider before issuing.
 */
export async function retryEinvoiceAction(raw: unknown) {
  return runAdminAction(einvoiceRetrySchema, raw, 'orders.process', retryEinvoice);
}
