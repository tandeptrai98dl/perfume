/**
 * Payment module public API (ARCHITECTURE.md §3.3): payment sessions, IPN/webhook processing,
 * manual bank transfers, COD remittances, refunds and the order timeout jobs. The only code
 * that changes `orders.payment_status`, `amount_paid` and `amount_refunded` (ADR-0005).
 */
export { createPaymentSession, reservationCap, type CreatePaymentSessionInput } from './sessions';
export { processGatewayNotification } from './notifications';
export {
  completeRefund,
  confirmBankTransfer,
  createCodRemittance,
  recordManualBankTransfer,
  requestRefund,
  type ManualTransferResult,
} from './commands';
export { queueRefundForCancelledOrder } from './ledger';
export {
  cancelUnconfirmedCodOrders,
  completeDeliveredOrders,
  expireUnpaidOrders,
  type TimeoutDeps,
} from './timeouts';
export {
  findOrderByCode,
  getCheckoutResult,
  getPaymentOverview,
  getPaymentStatusSnapshot,
  listBankTransferOrders,
  listCodRemittanceCandidates,
  listCodRemittances,
  listPaymentEvents,
  listPayments,
  listRefunds,
  type BankTransferOrderRow,
  type CheckoutResult,
  type CheckoutResultItem,
  type CodCandidateRow,
  type CodRemittanceRow,
  type PaymentEventRow,
  type PaymentListRow,
  type PaymentStatusSnapshot,
  type RefundRow,
} from './queries';
export {
  codRemittanceSchema,
  completeRefundSchema,
  confirmBankTransferSchema,
  ONLINE_PROVIDERS,
  onlineProviderSchema,
  PAYMENT_EVENT_FILTERS,
  REFUND_FILTERS,
  REFUND_METHODS,
  REMITTANCE_CARRIERS,
  requestRefundSchema,
  type CodRemittanceInput,
  type CompleteRefundInput,
  type ConfirmBankTransferInput,
  type RequestRefundInput,
} from './schemas';
export {
  computePaymentStatus,
  isRequirementCovered,
  nextSessionAmount,
  PAYMENT_STATUSES,
  refundableAmount,
  remittanceDifference,
  requiredOnlineAmount,
  type PaymentStatus,
} from './status';
export { generateTxnRef, transferNote, TXN_REF_PATTERN } from './txn-ref';
export type {
  NotificationOutcome,
  NotificationResult,
  OnlineProvider,
  PaymentDeps,
  PaymentSessionView,
  TimeoutRunResult,
} from './types';
