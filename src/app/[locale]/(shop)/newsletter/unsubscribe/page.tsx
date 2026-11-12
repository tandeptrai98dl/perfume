import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { NewsletterUnsubscribe } from '@/components/shop/newsletter-unsubscribe';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import { getNewsletterUnsubscribe } from '@/server/modules/customer';

import { resolveLocale } from '../../_content/shared';

type Props = PageProps<'/[locale]/newsletter/unsubscribe'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });
  return { title: t('unsubscribe.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Signed unsubscribe link of every marketing e-mail: one button, no sign-in. Mail clients
 * that support RFC 8058 unsubscribe without this page (`/api/newsletter/unsubscribe`).
 */
export default async function NewsletterUnsubscribePage({ params, searchParams }: Props) {
  await resolveLocale(params);
  return (
    <div className="container-content py-10 lg:py-16">
      <div className="flex max-w-2xl flex-col gap-8">
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <UnsubscribeContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function UnsubscribeContent({ searchParams }: { searchParams: Props['searchParams'] }) {
  const query = await searchParams;
  await connection();
  const t = await getTranslations('newsletter.unsubscribe');
  const s = first(query.s);
  const sig = first(query.t);
  const view = await getNewsletterUnsubscribe(getDb(), {
    secret: serverEnv().BETTER_AUTH_SECRET,
    s,
    t: sig,
  });
  if (!view || !s || !sig) {
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
      <NewsletterUnsubscribe
        subscriberId={s}
        signature={sig}
        maskedEmail={view.maskedEmail}
        subscribed={view.subscribed}
      />
    </>
  );
}
