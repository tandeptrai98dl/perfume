/**
 * Reporting module public API (M3 KPI dashboard, §11.2). Read-only: it owns no table and only
 * aggregates other modules' data. Shared with the worker: no `server-only`, no Next.js APIs.
 */
export { getDashboard, type Dashboard } from './dashboard';
export {
  cashSummary,
  codPendingRemittance,
  dailyRevenue,
  englishCoverage,
  NON_REVENUE_STATUSES,
  openPrivacyRequests,
  openRefunds,
  ordersByStatus,
  pendingReviewCount,
  salesSummary,
  topProducts,
  type CashSummary,
  type CodPending,
  type DailyPoint,
  type OpenPrivacyRequests,
  type OpenRefunds,
  type SalesSummary,
  type StatusCount,
  type TopProduct,
  type TranslationCoverage,
} from './queries';
export {
  DEFAULT_RANGE,
  isRangePreset,
  RANGE_PRESETS,
  resolveRange,
  VIETNAM_TIME_ZONE,
  vietnamDate,
  vietnamDayStart,
  type DateRange,
  type RangePreset,
} from './range';
