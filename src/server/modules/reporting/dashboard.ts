import { hasPermission } from '@/server/auth/permissions';
import type { Database } from '@/server/db/client';

import {
  cashSummary,
  codPendingRemittance,
  dailyRevenue,
  englishCoverage,
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
import { resolveRange, type DateRange, type RangePreset } from './range';

/**
 * KPI dashboard (§11.2) for one role and date range. Each widget is gated by the permission
 * of the screen it summarizes (RBAC §11.1), and figures a role may not see are never queried,
 * so they cannot leak to the client. Money (revenue, cash, AOV, COD amounts, product revenue)
 * needs `dashboard.viewRevenue`.
 */
export type Dashboard = {
  range: DateRange;
  /** Order counts for staff; money fields are zero/absent without `dashboard.viewRevenue`. */
  sales: SalesSummary | null;
  canViewRevenue: boolean;
  cash: CashSummary | null;
  daily: DailyPoint[] | null;
  byStatus: StatusCount[] | null;
  topProducts: TopProduct[] | null;
  codPending: CodPending | null;
  pendingReviews: number | null;
  refunds: OpenRefunds | null;
  privacy: OpenPrivacyRequests | null;
  translations: TranslationCoverage | null;
};

function withoutMoney(sales: SalesSummary): SalesSummary {
  return { ...sales, grossSales: 0, refunded: 0, netRevenue: 0, averageOrderValue: 0 };
}

export async function getDashboard(
  db: Pick<Database, 'select'>,
  role: string,
  preset: RangePreset,
  now: Date = new Date(),
): Promise<Dashboard> {
  const range = resolveRange(preset, now);
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(role, permission);
  const revenue = can('dashboard.viewRevenue');
  const orders = can('orders.view');
  const skip = Promise.resolve(null);

  const [sales, cash, daily, byStatus, top, cod, reviews, refunds, privacy, translations] =
    await Promise.all([
      orders || revenue ? salesSummary(db, range) : skip,
      revenue ? cashSummary(db, range) : skip,
      revenue ? dailyRevenue(db, range) : skip,
      orders ? ordersByStatus(db, range) : skip,
      revenue ? topProducts(db, range) : skip,
      can('payments.reconcileCod') ? codPendingRemittance(db) : skip,
      can('reviews.moderate') ? pendingReviewCount(db) : skip,
      can('payments.refund') ? openRefunds(db) : skip,
      can('privacyRequests.handle') ? openPrivacyRequests(db, now) : skip,
      can('translations.edit') ? englishCoverage(db) : skip,
    ]);

  return {
    range,
    sales: sales && !revenue ? withoutMoney(sales) : sales,
    canViewRevenue: revenue,
    cash,
    daily,
    byStatus,
    topProducts: top,
    codPending: cod,
    pendingReviews: reviews,
    refunds,
    privacy,
    translations,
  };
}
