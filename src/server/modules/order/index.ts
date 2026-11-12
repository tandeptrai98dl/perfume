/**
 * Order module public API. Foundation (M2): state machine, `transitionOrder`, order events and
 * codes. Streams add their blocks below: checkout `placeOrder` (checkout stream), admin queries
 * and commands (admin stream), customer queries (account stream).
 */
export {
  canTransition,
  customerCanCancel,
  DEDUCTED_STATUSES,
  CLOSED_STATUSES,
  isTerminal,
  nextStatuses,
  ORDER_STATUSES,
  RESERVING_STATUSES,
  type OrderStatus,
  type TransitionActor,
} from './state-machine';
export {
  lockOrder,
  recordOrderEvent,
  transitionOrder,
  type OrderActor,
  type TransitionInput,
  type TransitionResult,
} from './transition';
export { generateOrderCode, ORDER_CODE_PATTERN } from './codes';

// ---------- Admin (admin-orders stream) ----------
export {
  addOrderNote,
  bulkConfirmOrders,
  cancelOrder,
  changeOrderStatus,
  orderTags,
  shipOrder,
  transitionInTx,
  type BulkConfirmResult,
  type OrderCommandResult,
} from './admin-commands';
export {
  codRiskForPhone,
  countOrdersByStatus,
  getAdminOrderDetail,
  getPrintableOrders,
  listAdminOrders,
  revenueStats,
  startOfVietnamDay,
  tabCounts,
  type AdminOrderAddress,
  type AdminOrderDetail,
  type AdminOrderEvent,
  type AdminOrderPayment,
  type AdminOrderRefund,
  type AdminOrderRow,
  type CodRisk,
  type OrderStatusCounts,
  type PrintableOrder,
  type RevenueStats,
  type RevenueWindow,
  type VatInvoice,
} from './admin-queries';
export {
  bulkOrdersSchema,
  cancelOrderSchema,
  CARRIERS,
  dateRangeBounds,
  MAX_BULK_ORDERS,
  ORDER_COMMAND_TARGETS,
  ORDER_SORTS,
  ORDER_TAB_KEYS,
  ORDER_TABS,
  orderListFiltersSchema,
  orderNoteSchema,
  orderTransitionSchema,
  parseOrderListFilters,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRINT_DOCUMENTS,
  shipOrderSchema,
  TRACKING_CODE,
  type BulkOrdersInput,
  type CancelOrderInput,
  type Carrier,
  type OrderListFilters,
  type OrderListQuery,
  type OrderNoteInput,
  type OrderTab,
  type OrderTransitionInput,
  type PaymentMethod,
  type PaymentStatus,
  type PrintDocument,
  type ShipOrderInput,
} from './admin-schemas';
export {
  canViewContact,
  contactView,
  depositSatisfied,
  orderMoneySummary,
  packingSlipView,
  partialEmail,
  partialPhone,
  staffNextStatuses,
  staffOrderActor,
  type ContactView,
  type OrderMoneySummary,
  type PackingSlipTotals,
  type PrintLine,
} from './admin-view';
// ---------- End admin ----------
// Customer (account & notifications stream): own-order reads scoped by user_id, guest lookup,
// read model for emails, customer cancellation.
export {
  findOrderCodeForLookup,
  getCustomerOrder,
  getOrderViewByCode,
  getOrderViewById,
  listCustomerOrders,
  normalizeOrderCode,
  type CustomerOrderRow,
  type OrderTimelineEntry,
  type OrderView,
} from './customer-queries';
export { cancelCustomerOrder, CUSTOMER_CANCEL_REASON } from './customer-commands';
// ---------- Order edits before shipment (order-edits stream, wave 2) ----------
export {
  editOrder,
  previewOrderEdit,
  searchOrderEditVariants,
  type EditCouponOutcome,
  type EditPreviewLine,
  type OrderEditPreview,
  type OrderEditResult,
} from './admin-edit';
export {
  canEditOrder,
  EDITABLE_STATUSES,
  type CurrentLine,
  type EditAddress,
  type LineDiff,
} from './admin-edit-plan';
export {
  getOrderEditForm,
  ORDER_EDITED_EVENT,
  searchEditVariants,
  type EditVariantOption,
  type OrderEditForm,
} from './admin-edit-queries';
export {
  EDIT_LIMITS,
  editVariantSearchSchema,
  MAX_EDIT_LINES,
  MAX_EDIT_QUANTITY,
  orderEditSchema,
  type EditVariantSearchInput,
  type OrderEditFormInput,
  type OrderEditInput,
} from './admin-edit-schemas';
// ---------- End order edits ----------
// ---------- E-invoice (M3 e-invoicing stream, D13) ----------
export { recordEinvoiceIssued, recordEinvoiceReplaced } from './einvoice-record';
// ---------- Privacy requests (M3 privacy stream): data export + anonymisation ----------
export {
  ANONYMIZED_TEXT,
  anonymizeOrdersForSubject,
  CLOSED_ORDER_STATUSES,
  countOpenOrdersForSubject,
  listOrdersForDataExport,
  scrubEventDiff,
  takeReturnPhotosForSubject,
  type OrderDataExport,
  type OrderSubject,
} from './privacy';
// ---------- End privacy ----------
// ---------- M3 wave 2 storefront: best sellers (home rail, "best selling" sort) ----------
export {
  BEST_SELLER_RANK_LIMIT,
  BEST_SELLER_WINDOW_DAYS,
  bestSellerWindowStart,
  listBestSellingProductIds,
} from './best-sellers';
// ---------- Customer returns (M3 wave 2 returns stream, ADR-0017) ----------
export {
  FAULT_REASONS,
  parseReturnReceived,
  parseReturnRequested,
  RETURN_EVENT_TYPES,
  RETURN_EVENTS,
  RETURN_OUTCOMES,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  returnReceivedMetadata,
  returnRefundBreakdown,
  returnPhotoSchema,
  returnRequestedMetadata,
  type ReturnOutcome,
  type ReturnPhoto,
  type ReturnRequestedMetadataInput,
  type ReturnReason,
  type ReturnReceivedMetadata,
  type ReturnRefundBreakdown,
  type ReturnRequestedMetadata,
  type ReturnResolution,
} from './return-events';
// ---------- End returns ----------
