import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { GuestRequestConfirm } from '@/components/privacy/guest-request-confirm';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { serverEnv } from '@/lib/env';
import { readGuestRequestToken } from '@/server/modules/customer';

import { resolveLocale } from '../../_content/shared';
import { AccountSkeleton } from '../../account/_lib/account-page';

type Props = PageProps<'/[locale]/privacy-request/confirm'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'privacyRequest' });
  return { title: t('confirm.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Confirmation page of the e-mail link. Opening the link files nothing (mail scanners follow
 * links): the visitor presses "Confirm", which re-verifies the signed token on the server.
 */
export default async function ConfirmPrivacyRequestPage({ params, searchParams }: Props) {
  await resolveLocale(params);
  return (
    <div className="container-content py-10 lg:py-16">
      <div className="flex max-w-2xl flex-col gap-8">
        <Suspense fallback={<AccountSkeleton />}>
          <ConfirmContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function ConfirmContent({ searchParams }: { searchParams: Props['searchParams'] }) {
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const t = await getTranslations('privacyRequest');
  const request = readGuestRequestToken(serverEnv().BETTER_AUTH_SECRET, token);
  if (!request || !token) {
    return (
      <>
        <header className="flex flex-col gap-2">
          <h1 className="text-h1">{t('confirm.invalidTitle')}</h1>
          <p className="text-taupe-600">{t('confirm.invalidText')}</p>
        </header>
        <Button asChild variant="secondary" className="self-start">
          <Link href="/privacy-request">{t('confirm.again')}</Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{t('confirm.title')}</h1>
        <p className="text-taupe-600">{t('confirm.intro')}</p>
      </header>
      <GuestRequestConfirm
        token={token}
        email={request.email}
        type={request.type}
        details={request.details}
      />
    </>
  );
}
