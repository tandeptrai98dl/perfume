import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { SettingsManager } from '@/components/admin/settings/settings-manager';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  EINVOICE_VAT_RATES,
  getSettingsForAdmin,
  SETTINGS_PERMISSION,
} from '@/server/modules/settings';

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage(SETTINGS_PERMISSION);
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.settings' });
  const values = await getSettingsForAdmin(getDb());
  const env = serverEnv();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsManager
        values={values}
        vatRates={EINVOICE_VAT_RATES}
        env={{
          // Only whether the bot is configured; the token never leaves the server (ADR-0007).
          telegramBotConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
          staffAlertEmailFallback: Boolean(env.STAFF_ALERT_EMAIL),
          emailFrom: env.EMAIL_FROM,
        }}
      />
    </>
  );
}
