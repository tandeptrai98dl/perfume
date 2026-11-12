import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { GuestRequestForm } from '@/components/privacy/guest-request-form';
import { Link } from '@/i18n/navigation';

import { resolveLocale } from '../_content/shared';

type Props = PageProps<'/[locale]/privacy-request'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'privacyRequest' });
  return { title: t('metaTitle'), description: t('intro') };
}

/**
 * Data-subject requests without an account (PDPL 91/2025): the visitor proves control of the
 * e-mail address through a confirmation link before anything is filed.
 */
export default async function PrivacyRequestPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'privacyRequest' });
  return (
    <div className="container-content py-10 lg:py-16">
      <div className="flex max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-h1">{t('title')}</h1>
          <p className="text-taupe-600">{t('intro')}</p>
        </header>
        <GuestRequestForm />
        <p className="text-small">
          {t('memberHint')}{' '}
          <Link href="/account/privacy" className="text-gold-700 hover:underline">
            {t('memberLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}
