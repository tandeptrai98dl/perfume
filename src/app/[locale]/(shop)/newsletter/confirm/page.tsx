import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { NewsletterConfirm } from '@/components/shop/newsletter-confirm';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { serverEnv } from '@/lib/env';
import { readNewsletterSignupToken } from '@/server/modules/customer';

import { resolveLocale } from '../../_content/shared';

type Props = PageProps<'/[locale]/newsletter/confirm'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });
  return { title: t('confirm.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Double opt-in page behind the e-mailed link. Opening the link subscribes nobody (mail
 * scanners follow links): the visitor presses "Confirm", which re-verifies the signed token.
 */
export default async function NewsletterConfirmPage({ params, searchParams }: Props) {
  await resolveLocale(params);
  return (
    <div className="container-content py-10 lg:py-16">
      <div className="flex max-w-2xl flex-col gap-8">
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <ConfirmContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function ConfirmContent({ searchParams }: { searchParams: Props['searchParams'] }) {
  const query = await searchParams;
  // The token's expiry is checked against the request time.
  await connection();
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const t = await getTranslations('newsletter.confirm');
  const signup = readNewsletterSignupToken(serverEnv().BETTER_AUTH_SECRET, token);
  if (!signup || !token) {
    return (
      <>
        <header className="flex flex-col gap-2">
          <h1 className="text-h1">{t('invalidTitle')}</h1>
          <p className="text-taupe-600">{t('invalidText')}</p>
        </header>
        <Button asChild variant="secondary" className="self-start">
          <Link href="/">{t('home')}</Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-taupe-600">{t('intro')}</p>
      </header>
      <NewsletterConfirm token={token} email={signup.email} />
    </>
  );
}
