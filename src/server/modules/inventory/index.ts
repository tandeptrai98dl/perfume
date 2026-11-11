/**
 * Inventory module public API. Stream A adds the storefront read side (availability) above;
 * the admin write side lives in its own block below.
 */

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
