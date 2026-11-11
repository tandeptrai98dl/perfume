import { z } from 'zod';

/** Input schemas of payment commands (admin Server Actions and storefront retry). */

const money = z
  .number({ error: 'required' })
  .int('integer')
  .positive('tooSmall')
  .max(10_000_000_000, 'tooLarge');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'tooLong')
    .nullish()
    .transform((value) => value || null);

export const ONLINE_PROVIDERS = ['vnpay', 'payos'] as const;
export const onlineProviderSchema = z.enum(ONLINE_PROVIDERS);

export const confirmBankTransferSchema = z.object({
  orderId: z.uuid(),
  amount: money,
  bankReference: z.string().trim().min(1, 'required').max(100, 'tooLong'),
  note: optionalText(500),
});
export type ConfirmBankTransferInput = z.output<typeof confirmBankTransferSchema>;

export const REMITTANCE_CARRIERS = ['ghn', 'ghtk', 'viettel_post', 'self', 'other'] as const;

const isoDate = z.iso.date('invalid');

export const codRemittanceSchema = z
  .object({
    carrier: z.enum(REMITTANCE_CARRIERS, { error: 'required' }),
    periodStart: isoDate,
    periodEnd: isoDate,
    receivedAt: isoDate,
    bankReference: optionalText(100),
    carrierFee: z.number().int('integer').min(0, 'tooSmall').max(1_000_000_000, 'tooLarge'),
    totalAmount: z
      .number({ error: 'required' })
      .int('integer')
      .min(0, 'tooSmall')
      .max(100_000_000_000, 'tooLarge'),
    orders: z
      .array(z.object({ orderId: z.uuid(), amount: money }))
      .min(1, 'noOrders')
      .max(500, 'tooLarge'),
  })
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'endBeforeStart' });
    }
    const ids = value.orders.map((order) => order.orderId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['orders'], message: 'duplicate' });
    }
  });
export type CodRemittanceInput = z.output<typeof codRemittanceSchema>;

export const REFUND_METHODS = ['gateway', 'bank_transfer', 'cash'] as const;

export const requestRefundSchema = z.object({
  orderId: z.uuid(),
  amount: money,
  reason: z.string().trim().min(1, 'required').max(500, 'tooLong'),
  method: z.enum(REFUND_METHODS, { error: 'required' }),
  paymentId: z.uuid().nullish(),
});
export type RequestRefundInput = z.output<typeof requestRefundSchema>;

export const completeRefundSchema = z
  .object({
    refundId: z.uuid(),
    /** `gateway` calls the provider's refund API; `manual` records a bank/cash refund. */
    mode: z.enum(['gateway', 'manual']),
    providerRef: optionalText(100),
    proofMediaId: z.uuid().nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'manual' && !value.providerRef && !value.proofMediaId) {
      ctx.addIssue({ code: 'custom', path: ['providerRef'], message: 'proofRequired' });
    }
  });
export type CompleteRefundInput = z.output<typeof completeRefundSchema>;

/** Storefront: start or retry an online payment for an order the visitor can access. */
export const startPaymentSchema = z.object({
  code: z.string().trim().min(1).max(40),
  token: z.string().max(64).nullish(),
  provider: onlineProviderSchema,
});
export type StartPaymentInput = z.output<typeof startPaymentSchema>;

/** Admin lists. */
export const PAYMENT_EVENT_FILTERS = ['all', 'invalid', 'unmatched'] as const;
export const REFUND_FILTERS = ['open', 'completed', 'all'] as const;
