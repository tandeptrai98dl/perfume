'use server';

import 'server-only';

import {
  addCustomerNote,
  customerNoteSchema,
  setCodRiskFlag,
  setCodRiskFlagSchema,
} from '@/server/modules/customer';

import { runAdminAction } from './run';

/*
 * Admin customers (§5.2 /admin/customers, RBAC §11.1: Owner + Manager = `customers.view`).
 * COD risk flag (D16) with a reason and internal notes; both audited on the account.
 */

const PERMISSION = 'customers.view' as const;

export async function setCustomerCodRiskAction(raw: unknown) {
  return runAdminAction(setCodRiskFlagSchema, raw, PERMISSION, (ctx, input) =>
    setCodRiskFlag(ctx, input),
  );
}

export async function addCustomerNoteAction(raw: unknown) {
  return runAdminAction(customerNoteSchema, raw, PERMISSION, (ctx, input) =>
    addCustomerNote(ctx, input),
  );
}
