'use server';

import 'server-only';

import { z } from 'zod';

import { getPaymentGateways } from '@/server/integrations/payments';
import { DomainError } from '@/server/lib/command-context';
import {
  codRemittanceSchema,
  completeRefund,
  completeRefundSchema,
  confirmBankTransfer,
  confirmBankTransferSchema,
  createCodRemittance,
  findOrderByCode,
  REFUND_METHODS,
  requestRefund,
} from '@/server/modules/payment';

import { runAdminAction } from './run';

/*
 * Payments admin (§5.2 /admin/payments, RBAC §11.1): manual bank transfers and COD
 * remittances need `payments.confirmBankTransfer` / `payments.reconcileCod`, refunds
 * `payments.refund` (Owner, Manager). Commands re-check the permission and write the audit log.
 */

export async function confirmBankTransferAction(raw: unknown) {
  return runAdminAction(
    confirmBankTransferSchema,
    raw,
    'payments.confirmBankTransfer',
    confirmBankTransfer,
  );
}

export async function createCodRemittanceAction(raw: unknown) {
  return runAdminAction(codRemittanceSchema, raw, 'payments.reconcileCod', createCodRemittance);
}

const requestRefundByCodeSchema = z.object({
  orderCode: z.string().trim().min(1, 'required').max(40, 'tooLong'),
  amount: z.number({ error: 'required' }).int('integer').positive('tooSmall'),
  reason: z.string().trim().min(1, 'required').max(500, 'tooLong'),
  method: z.enum(REFUND_METHODS, { error: 'required' }),
});

export async function requestRefundAction(raw: unknown) {
  return runAdminAction(requestRefundByCodeSchema, raw, 'payments.refund', async (ctx, input) => {
    const order = await findOrderByCode(ctx.db, input.orderCode.toUpperCase());
    if (!order) throw new DomainError('invalid', [{ path: 'orderCode', code: 'orderNotFound' }]);
    return requestRefund(ctx, {
      orderId: order.id,
      amount: input.amount,
      reason: input.reason,
      method: input.method,
      paymentId: null,
    });
  });
}

export async function completeRefundAction(raw: unknown) {
  return runAdminAction(completeRefundSchema, raw, 'payments.refund', (ctx, input) =>
    completeRefund({ ...ctx, gateways: getPaymentGateways() }, input),
  );
}
