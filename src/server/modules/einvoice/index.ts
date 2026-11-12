/**
 * E-invoice module (D13, ADR-0013): builds the invoice from the order snapshot, issues it
 * through the `integrations/einvoice` adapter from the `einvoice.issue` job, staff retries and
 * the admin read models. Order data is written only through the order module's public API.
 */
export { amountInWords, type AmountWordsLexicon } from './amount-in-words';
export {
  buildEinvoiceDocument,
  InvoiceBuildError,
  invoiceBuyer,
  taxableOf,
  type InvoiceLabels,
  type InvoiceOrder,
  type InvoiceOrderItem,
} from './build';
export { invoiceLabels } from './labels';
export {
  countFailedEinvoices,
  getOrderEinvoice,
  listFailedEinvoices,
  type FailedEinvoiceRow,
  type IssuedEinvoiceView,
  type OrderEinvoiceView,
} from './queries';
export {
  einvoiceAdjustSchema,
  einvoiceRetrySchema,
  type EinvoiceAdjustInput,
  type EinvoiceRetryInput,
} from './schemas';
export {
  einvoiceEvents,
  einvoiceRef,
  EinvoiceRetryError,
  issueOrderEinvoice,
  retryEinvoice,
  runEinvoiceJob,
  type EinvoiceDeps,
  type IssueOutcome,
} from './service';
export {
  EINVOICE_ADJUSTMENT_ACTIONS,
  EINVOICE_ADJUSTMENT_EVENT_TYPES,
  EINVOICE_ADJUSTMENT_EVENTS,
  einvoiceAdjustmentStatus,
  type EinvoiceAdjustmentAction,
  type EinvoiceAdjustmentEventRow,
  type EinvoiceAdjustmentState,
  type EinvoiceAdjustmentSummary,
  attemptsSinceRetry,
  EINVOICE_ELIGIBLE_STATUSES,
  EINVOICE_EVENT_TYPES,
  EINVOICE_EVENTS,
  EINVOICE_MAX_ATTEMPTS,
  einvoiceStatus,
  type EinvoiceEventRow,
  type EinvoiceState,
  type EinvoiceStatusSummary,
} from './state';
// ---------- Cancellation / replacement (M3 wave 2 returns stream) ----------
export { invoiceAfterReturns, type InvoiceItemWithId } from './after-returns';
export {
  adjustOrderEinvoice,
  cancelEinvoice,
  currentIssuedInvoice,
  einvoiceAdjustmentEvents,
  replaceEinvoice,
  requestEinvoiceAdjustment,
  requestEinvoiceAfterReturn,
  runEinvoiceAdjustmentJob,
  type AdjustmentOutcome,
  type AdjustmentRequest,
} from './adjustments';
export { acceptedReturns } from './service';
