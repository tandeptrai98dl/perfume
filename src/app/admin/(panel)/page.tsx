import { getFormatter, getTranslations } from 'next-intl/server';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import {
  AttentionList,
  DailyRevenueChart,
  KpiTiles,
  RangeTabs,
  StatusBreakdown,
  TopProductsTable,
  type AttentionItem,
} from '@/components/admin/dashboard/kpi-widgets';
import { LowStockList } from '@/components/admin/inventory/low-stock-list';
import { OrderQueues } from '@/components/admin/orders/dashboard-widgets';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission, isStaffRole } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { listLowStock } from '@/server/modules/inventory';
import { countOrdersByStatus, tabCounts } from '@/server/modules/order';
import { DEFAULT_RANGE, getDashboard, RANGE_PRESETS } from '@/server/modules/reporting';

const loadRange = createLoader({
  range: parseAsStringLiteral(RANGE_PRESETS).withDefault(DEFAULT_RANGE),
});

export default function AdminDashboardPage(props: PageProps<'/admin'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard {...props} />
    </Suspense>
  );
}

/**
 * KPI dashboard (§11.2): live work queues, KPIs for a Vietnam-time date range, orders by
 * status, best sellers, low stock and counters of work waiting elsewhere. Every widget follows
 * the permission of the screen it summarizes; money needs `dashboard.viewRevenue`.
 */
async function Dashboard({ searchParams }: PageProps<'/admin'>) {
  const { user } = await requireAdminPage();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const format = await getFormatter({ locale: 'vi' });
  const role = user.role ?? 'customer';
  const db = getDb();
  const { range: preset } = await loadRange(searchParams);
  const canOrders = hasPermission(role, 'orders.view');
  const canStock = hasPermission(role, 'inventory.adjust');
  const [dashboard, counts, lowStock] = await Promise.all([
    getDashboard(db, role, preset),
    canOrders ? countOrdersByStatus(db) : null,
    canStock ? listLowStock(db, 10) : null,
  ]);
  const vnd = (amount: number) =>
    format.number(amount, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
  const lastDay = new Date(dashboard.range.end.getTime() - 1);
  const dateFormat = { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' } as const;

  const attention: AttentionItem[] = [];
  if (dashboard.codPending) {
    attention.push({
      key: 'cod',
      label: t('dashboard.codPending'),
      value: t('dashboard.codPendingValue', {
        count: dashboard.codPending.orders,
        amount: vnd(dashboard.codPending.amount),
      }),
      href: '/admin/payments/cod-remittances',
    });
  }
  if (dashboard.refunds) {
    attention.push({
      key: 'refunds',
      label: t('dashboard.openRefunds'),
      value: t('dashboard.openRefundsValue', {
        count: dashboard.refunds.count,
        amount: vnd(dashboard.refunds.amount),
      }),
      href: '/admin/payments/refunds',
      alert: dashboard.refunds.count > 0,
    });
  }
  if (dashboard.pendingReviews !== null) {
    attention.push({
      key: 'reviews',
      label: t('dashboard.pendingReviews'),
      value: format.number(dashboard.pendingReviews),
      href: '/admin/reviews',
    });
  }
  if (dashboard.privacy) {
    attention.push({
      key: 'privacy',
      label: t('dashboard.privacyRequests'),
      value: t('dashboard.privacyValue', dashboard.privacy),
      href: '/admin/privacy-requests',
      alert: dashboard.privacy.overdue > 0,
    });
  }
  if (dashboard.translations) {
    const { activeProducts, missingEnglish } = dashboard.translations;
    attention.push({
      key: 'translations',
      label: t('dashboard.missingEnglish'),
      value: t('dashboard.missingEnglishValue', {
        missing: missingEnglish,
        total: activeProducts,
        coverage: activeProducts
          ? Math.floor(((activeProducts - missingEnglish) / activeProducts) * 100)
          : 100,
      }),
      href: '/admin/products',
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h2">{t('dashboard.title')}</h1>
        <p>{t('dashboard.welcome', { name: user.name })}</p>
        {isStaffRole(role) && (
          <p className="text-small text-taupe-600">
            {t('dashboard.role', { role: t(`roles.${role}`) })}
          </p>
        )}
      </header>
      {counts && <OrderQueues queues={tabCounts(counts)} />}
      {dashboard.sales && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RangeTabs active={preset} presets={RANGE_PRESETS} />
            <p className="text-small text-taupe-600">
              {t('dashboard.rangeCaption', {
                from: format.dateTime(dashboard.range.start, dateFormat),
                to: format.dateTime(lastDay, dateFormat),
              })}
            </p>
          </div>
          <KpiTiles
            sales={dashboard.sales}
            cash={dashboard.cash}
            showMoney={dashboard.canViewRevenue}
          />
          {dashboard.daily && dashboard.daily.length > 1 && (
            <DailyRevenueChart points={dashboard.daily} />
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            {dashboard.byStatus && <StatusBreakdown rows={dashboard.byStatus} />}
            {dashboard.topProducts && <TopProductsTable rows={dashboard.topProducts} />}
          </div>
        </div>
      )}
      <AttentionList items={attention} />
      {lowStock && <LowStockList rows={lowStock} />}
    </div>
  );
}
