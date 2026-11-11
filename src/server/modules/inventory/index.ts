/** Public API of the inventory module: storefront availability and admin stock changes. */
export {
  availableQuantitySql,
  DEFAULT_LOW_STOCK_THRESHOLD,
  getVariantAvailability,
  stockStateOf,
  type StockState,
  type VariantAvailability,
} from './queries';

// Admin (write side)
export {
  adjustStock,
  ensureInventoryItems,
  getDefaultLocationId,
  hasStockHistory,
  setLowStockThreshold,
  type StockAdjustResult,
} from './commands';
export {
  listLowStock,
  listMovements,
  listStock,
  getStockForVariants,
  STOCK_SORTS,
  type MovementRow,
  type StockListQuery,
  type StockRow,
  type StockSort,
} from './admin-queries';
export {
  ADJUSTMENT_MODES,
  ADJUSTMENT_REASONS,
  lowStockThresholdSchema,
  MAX_STOCK_QUANTITY,
  stockAdjustSchema,
  type AdjustmentMode,
  type AdjustmentReason,
  type LowStockThresholdInput,
  type StockAdjustInput,
} from './admin-schemas';
export { availableStock, computeAdjustment, isLowStock } from './adjustment';

// Reservations (M2 foundation): placeOrder, payments and transitionOrder use these.
export {
  commitReservations,
  extendReservations,
  releaseReservations,
  reserveStock,
  restockOrder,
  type ReservationLine,
} from './reservations';

// Order edits before shipment (wave 2, order-edits stream).
export {
  activeReservationExpiry,
  adjustOrderStock,
  type AdjustOrderStockInput,
  type OrderStockChange,
} from './order-adjustments';
