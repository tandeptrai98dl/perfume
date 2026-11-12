import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { Suspense } from 'react';

import { ConsentForm } from '@/components/privacy/privacy-center/consent-form';
import { ConsentHistory } from '@/components/privacy/privacy-center/consent-history';
import { PrivacyRequests } from '@/components/privacy/privacy-center/privacy-requests';
import { RequestActions } from '@/components/privacy/privacy-center/request-actions';
import {
  COOKIE_CONSENT_NAME,
  isCurrentConsent,
  parseCookieConsent,
} from '@/lib/privacy/cookie-consent';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import {
  getConsentState,
  isExportDownloadable,
  listAccountPrivacyRequests,
  listConsentHistory,
} from '@/server/modules/customer';

import {
  AccountHeader,
  accountLocale,
  accountMetadata,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/privacy'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return accountMetadata(params, 'privacy.metaTitle');
}

/**
 * Privacy centre (§10.6, PDPL 91/2025): consents (view / withdraw), consent history, personal
 * data export, correction and deletion requests with their legal due dates.
 */
export default function PrivacyCenterPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <PrivacyCenter params={params} />
    </Suspense>
  );
}

async function PrivacyCenter({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/privacy' });
  const [t, jar] = await Promise.all([
    getTranslations({ locale, namespace: 'privacyCenter' }),
    cookies(),
  ]);
  const db = getDb();
  const [state, history, requests] = await Promise.all([
    getConsentState(db, session.user.id),
    listConsentHistory(db, session.user.id),
    listAccountPrivacyRequests(db, session.user.id),
  ]);
  const cookieConsent = parseCookieConsent(jar.get(COOKIE_CONSENT_NAME)?.value);
  const device = isCurrentConsent(cookieConsent) ? cookieConsent : null;
  const openTypes = requests
    .filter((request) => request.status === 'received' || request.status === 'in_progress')
    .map((request) => request.type);

  return (
    <>
      <AccountHeader title={t('title')} intro={t('intro')} />
      <div className="flex flex-col gap-12">
        <section aria-labelledby="privacy-consents" className="flex flex-col gap-4">
          <h2 id="privacy-consents" className="text-h2">
            {t('consents.title')}
          </h2>
          <p className="text-taupe-600">{t('consents.intro')}</p>
          <ConsentForm
            initial={{
              marketingEmail: state.marketing_email.granted,
              marketingSms: state.marketing_sms.granted,
              analytics: device?.analytics ?? false,
              ads: device?.ads ?? false,
            }}
          />
        </section>

        <section aria-labelledby="privacy-requests" className="flex flex-col gap-4">
          <h2 id="privacy-requests" className="text-h2">
            {t('requests.title')}
          </h2>
          <p className="text-taupe-600">{t('requests.intro')}</p>
          <RequestActions openTypes={openTypes} />
          <PrivacyRequests
            requests={requests.map((request) => ({
              id: request.id,
              type: request.type,
              status: request.status,
              createdAt: request.createdAt.toISOString(),
              dueAt: request.dueAt.toISOString(),
              completedAt: request.completedAt?.toISOString() ?? null,
              downloadable: isExportDownloadable(request),
            }))}
          />
        </section>

        <section aria-labelledby="privacy-history" className="flex flex-col gap-4">
          <h2 id="privacy-history" className="text-h2">
            {t('history.title')}
          </h2>
          <ConsentHistory
            entries={history.map((entry) => ({
              id: entry.id,
              purpose: entry.purpose,
              granted: entry.granted,
              source: entry.source,
              policyVersion: entry.policyVersion,
              createdAt: entry.createdAt.toISOString(),
            }))}
          />
        </section>
      </div>
    </>
  );
}
