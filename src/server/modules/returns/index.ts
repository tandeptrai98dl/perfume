/**
 * Returns module (ADR-0017, M3 wave 2): customer return requests, staff approval/rejection and
 * receipt (refund, restock, replacement, e-invoice adjustment). Owns no table: the request and
 * its decisions are `order_events`, written through the order module's public API; stock,
 * money and invoices go through the inventory, payment and einvoice modules.
 */
export {
  DAY_MS,
  defaultResellable,
  foldReturnEvents,
  isFaultReason,
  isFullReturn,
  lineRefundAmount,
  planReturnRefund,
  resolutionsFor,
  RETURN_DESCRIPTION_MAX,
  RETURN_DESCRIPTION_MIN_FAULT,
  returnDeadline,
  returnEligibility,
  validateReturnLines,
  type ReturnEligibility,
  type ReturnEventRow,
  type ReturnIneligibility,
  type ReturnLineInput,
  type ReturnOrderLine,
  type ReturnRefundInput,
  type ReturnRefundPlan,
  type ReturnState,
  type ReturnStatus,
} from './rules';
export {
  approveReturnSchema,
  MAX_RETURN_SHIPPING_FEE,
  receiveReturnSchema,
  rejectReturnSchema,
  returnRequestSchema,
  type ApproveReturnInput,
  type ReceiveReturnInput,
  type RejectReturnInput,
  type ReturnRequestInput,
} from './schemas';
export {
  approveReturn,
  receiveReturn,
  rejectReturn,
  requestReturn,
  returnEvents,
  type ReceiveReturnResult,
  type ReturnCommandResult,
  type ReturnRequestResult,
} from './service';
export {
  countReturnQueue,
  findOrderForReturn,
  getAdminReturn,
  getCustomerReturnView,
  listReturnQueue,
  type AdminReturnLine,
  type AdminReturnView,
  type CustomerReturnView,
  type ReturnQueueRow,
} from './queries';
export {
  FAULT_REASONS,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  type ReturnOutcome,
  type ReturnReason,
  type ReturnResolution,
} from '@/server/modules/order';
