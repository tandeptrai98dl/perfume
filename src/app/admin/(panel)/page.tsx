import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { LowStockList } from '@/components/admin/inventory/low-stock-list';
import {
  OrderQueues,
  OrdersByStatus,
  RevenueCards,
} from '@/components/admin/orders/dashboard-widgets';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission, isStaffRole } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { listLowStock } from '@/server/modules/inventory';
import { countOrdersByStatus, revenueStats, tabCounts } from '@/server/modules/order';

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

/** Dashboard (§11.2): work queues, orders by status, low stock; revenue for Owner/Manager. */
async function Dashboard() {
  const { user } = await requireAdminPage();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const role = user.role ?? 'customer';
  const db = getDb();
  const canOrders = hasPermission(role, 'orders.view');
  const canStock = hasPermission(role, 'inventory.adjust');
  const canRevenue = hasPermission(role, 'dashboard.viewRevenue');
  const [counts, lowStock, revenue] = await Promise.all([
    canOrders ? countOrdersByStatus(db) : null,
    canStock ? listLowStock(db, 10) : null,
    canRevenue ? revenueStats(db) : null,
  ]);
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
      {revenue && <RevenueCards stats={revenue} />}
      {counts && <OrderQueues queues={tabCounts(counts)} />}
      <div className="grid gap-6 lg:grid-cols-2">
        {counts && <OrdersByStatus counts={counts} />}
        {lowStock && <LowStockList rows={lowStock} />}
      </div>
    </div>
  );
}
