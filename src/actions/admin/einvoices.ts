'use server';

import 'server-only';

import {
  cancelEinvoice,
  einvoiceAdjustSchema,
  einvoiceRetrySchema,
  replaceEinvoice,
  retryEinvoice,
} from '@/server/modules/einvoice';

import { runAdminAction } from './run';

/*
 * E-invoices (D13): staff retry a failed (or never started) invoice of a delivered order from
 * the order page or the failed list. `orders.process` (Owner, Manager, Staff); idempotent —
 * the job checks the provider before issuing.
 */
export async function retryEinvoiceAction(raw: unknown) {
  return runAdminAction(einvoiceRetrySchema, raw, 'orders.process', retryEinvoice);
}

/*
 * Cancellation and replacement of an issued invoice (returns, corrections): legal documents
 * that follow a refund decision, so Owner/Manager (`payments.refund`). Both only enqueue the
 * `einvoice.adjust` job (audited); the provider is called by the worker.
 */
export async function cancelEinvoiceAction(raw: unknown) {
  return runAdminAction(einvoiceAdjustSchema, raw, 'payments.refund', cancelEinvoice);
}

export async function replaceEinvoiceAction(raw: unknown) {
  return runAdminAction(einvoiceAdjustSchema, raw, 'payments.refund', replaceEinvoice);
}
