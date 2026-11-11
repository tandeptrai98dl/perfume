import { ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CartLineItem } from '@/components/shop/cart-line-item';
import { CartSummary } from '@/components/shop/cart-summary';
import { CouponInput } from '@/components/shop/coupon-input';
import { GiftOptions } from '@/components/shop/gift-options';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentCartView } from '@/server/cart-session';

import { NOINDEX } from '../_lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/cart'>): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return { title: t('title'), description: t('metaDescription'), robots: NOINDEX };
}

/** Cart page (§5.1: dynamic, noindex). The cart follows the visitor across languages. */
export default async function CartPage({ params }: PageProps<'/[locale]/cart'>) {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return (
    <div className="container-content flex flex-col gap-10 py-10 lg:py-16">
      <h1 className="text-h1">{t('title')}</h1>
      <Suspense fallback={<CartSkeleton />}>
        <CartContent locale={locale} />
      </Suspense>
    </div>
  );
}

async function CartContent({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'cart' });
  const view = await getCurrentCartView(locale);

  if (view.lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag aria-hidden />}
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button asChild>
            <Link href="/perfumes">{t('empty.action')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
      <div className="flex flex-col gap-6">
        <ul aria-label={t('linesLabel')} className="border-line-200 border-t">
          {view.lines.map((line) => (
            <CartLineItem key={line.itemId} line={line} />
          ))}
        </ul>
        <Link
          href="/perfumes"
          className="text-small text-gold-700 inline-flex min-h-11 items-center self-start hover:underline"
        >
          {t('continueShopping')}
        </Link>
      </div>
      <aside className="flex flex-col gap-8 lg:sticky lg:top-8 lg:self-start">
        <div className="bg-sand-100 flex flex-col gap-8 p-6">
          <CartSummary view={view}>
            <CouponInput coupon={view.coupon} />
          </CartSummary>
        </div>
        <div className="border-line-200 border p-6">
          <GiftOptions gift={view.gift} />
        </div>
      </aside>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]" aria-hidden>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
