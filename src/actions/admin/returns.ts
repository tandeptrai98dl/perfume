'use server';

import 'server-only';

import {
  approveReturn,
  approveReturnSchema,
  openReturnForCustomer,
  receiveReturn,
  receiveReturnSchema,
  rejectReturn,
  rejectReturnSchema,
  staffReturnSchema,
} from '@/server/modules/returns';

import { runAdminAction } from './run';

/*
 * Customer returns (ADR-0017, §11.2). Approving or rejecting a request decides a refund, so it
 * needs `payments.refund` (Owner/Manager, RBAC §11.1 "Cancel paid orders, refund"). Recording
 * the parcel's arrival is warehouse work (`orders.process`); the refund it queues follows the
 * approved request, and reimbursing the customer's return shipping again needs
 * `payments.refund` (checked by the module).
 */
export async function approveReturnAction(raw: unknown) {
  return runAdminAction(approveReturnSchema, raw, 'payments.refund', approveReturn);
}

export async function rejectReturnAction(raw: unknown) {
  return runAdminAction(rejectReturnSchema, raw, 'payments.refund', rejectReturn);
}

export async function receiveReturnAction(raw: unknown) {
  return runAdminAction(receiveReturnSchema, raw, 'orders.process', receiveReturn);
}

/**
 * Open a return on the customer's behalf (phone, chat) — warehouse/order work
 * (`orders.process`); lifting the return window needs `payments.refund` (checked by the
 * module) and is audited (ADR-0027).
 */
export async function openReturnForCustomerAction(raw: unknown) {
  return runAdminAction(staffReturnSchema, raw, 'orders.process', (ctx, input) =>
    openReturnForCustomer(ctx, input),
  );
}
