import { randomBytes } from 'node:crypto';

import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ManualOrderForm } from '@/components/admin/orders/manual-order-form';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getPaymentGateways } from '@/server/integrations/payments';
import { PAYMENT_LINK_PROVIDERS } from '@/server/modules/checkout';
import { listProvinces } from '@/server/modules/customer';

/** Manual order for a phone/Zalo customer (§11.2, `orders.createManual`). */
export default function NewManualOrderPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { user } = await requireAdminPage('orders.createManual');
  const role = user.role ?? 'customer';
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.orders' });
  const provinces = await listProvinces(getDb());
  const gateways = getPaymentGateways();
  const providers = PAYMENT_LINK_PROVIDERS.filter((provider) => gateways[provider]);
  return (
    <>
      <PageHeader
        title={t('new.title')}
        description={t('new.description')}
        back={{ href: '/admin/orders', label: t('title') }}
      />
      <ManualOrderForm
        checkoutKey={randomBytes(18).toString('base64url')}
        provinces={provinces}
        providers={providers}
        canConfirm={hasPermission(role, 'orders.process')}
        canConfirmTransfer={hasPermission(role, 'payments.confirmBankTransfer')}
      />
    </>
  );
}
