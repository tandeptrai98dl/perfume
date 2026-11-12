import { Download } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CustomerTable } from '@/components/admin/customers/customer-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import {
  canSeeCustomerContact,
  CUSTOMER_EXPORT_LIMIT,
  customerListSchema,
  listCustomers,
  type CustomerFilter,
} from '@/server/modules/customer';

/**
 * Customers (§5.2, §11.2): registered accounts and guest contacts with order count, lifetime
 * spend, last order and COD risk. Owner + Manager (`customers.view`, §11.1); the CSV export is
 * Owner only (`customers.export`).
 */
export default function AdminCustomersPage(props: PageProps<'/admin/customers'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function exportQuery(filter: CustomerFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function Content({ searchParams }: PageProps<'/admin/customers'>) {
  const { user } = await requireAdminPage('customers.view');
  const role = user.role ?? 'customer';
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.customers' });
  const raw = await searchParams;
  const query = customerListSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );
  const data = await listCustomers(getDb(), query, { contactVisible: canSeeCustomerContact(role) });
  const canExport = hasPermission(role, 'customers.export');
  const filter: CustomerFilter = {
    q: query.q,
    type: query.type,
    risk: query.risk,
    sort: query.sort,
    dir: query.dir,
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canExport && (
            <Button asChild variant="secondary">
              <a href={`/api/admin/customers/export${exportQuery(filter)}`} download>
                <Download aria-hidden />
                {t('export')}
              </a>
            </Button>
          )
        }
      />
      {canExport && (
        <p className="text-small mb-4 text-taupe-600">
          {t('exportHint', { limit: CUSTOMER_EXPORT_LIMIT })}
        </p>
      )}
      <CustomerTable
        rows={data.rows.map((row) => ({
          key: row.key,
          type: row.type,
          name: row.name,
          phone: row.phone,
          email: row.email,
          orderCount: row.orderCount,
          lifetimeSpend: row.lifetimeSpend,
          lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
          failedDeliveries: row.failedDeliveries,
          codRiskFlag: row.codRiskFlag,
          since: row.since.toISOString(),
        }))}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
