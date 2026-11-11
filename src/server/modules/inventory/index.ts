/** Public API of the inventory module (read side: storefront availability). */
export {
  availableQuantitySql,
  DEFAULT_LOW_STOCK_THRESHOLD,
  getVariantAvailability,
  stockStateOf,
  type StockState,
  type VariantAvailability,
} from './queries';
