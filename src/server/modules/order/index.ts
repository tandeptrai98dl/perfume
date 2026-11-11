/**
 * Order module public API. Foundation (M2): state machine, `transitionOrder`, order events and
 * codes. Streams add their blocks below: checkout `placeOrder` (checkout stream), admin queries
 * and commands (admin stream), customer queries (account stream).
 */
export {
  canTransition,
  customerCanCancel,
  DEDUCTED_STATUSES,
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
