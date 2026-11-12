import { randomBytes } from 'node:crypto';

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CheckoutForm } from '@/components/shop/checkout/checkout-form';
import type { CheckoutPageData } from '@/components/shop/checkout/types';
import { Skeleton } from '@/components/ui/skeleton';
import { getInfoPage } from '@/data/content';
import { getPathname, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCheckoutCart } from '@/server/checkout-request';
import { getDb } from '@/server/db/client';
import { quoteCheckout } from '@/server/modules/checkout';
import { pagePath } from '@/server/modules/content';
import { listProvinces, listSavedAddresses, listWards } from '@/server/modules/customer';
import { resolveLocale } from '@/app/[locale]/(shop)/_content/shared';

type Props = PageProps<'/[locale]/checkout'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** One-page checkout (§10.4, §5.1: dynamic, noindex). */
export default async function CheckoutPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return (
    <div className="container-content flex flex-col gap-8 py-8 lg:py-12">
      <h1 className="text-h1">{t('title')}</h1>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent locale={locale} />
      </Suspense>
    </div>
  );
}

async function CheckoutContent({ locale }: { locale: Locale }) {
  const { cart, shopper } = await getCheckoutCart();
  if (!cart) return redirect({ href: '/cart', locale });

  const db = getDb();
  const [provinces, savedAddresses, terms, privacy] = await Promise.all([
    listProvinces(db),
    shopper.userId ? listSavedAddresses(db, shopper.userId) : Promise.resolve([]),
    getInfoPage('terms', locale),
    getInfoPage('privacy', locale),
  ]);
  const saved = savedAddresses[0] ?? null; // default first

  const quote = await quoteCheckout(db, {
    cart,
    locale,
    provinceCode: saved?.provinceCode ?? null,
    couponCode: cart.couponCode,
    customer: {
      phone: saved?.phone ?? shopper.phone ?? undefined,
      email: shopper.email ?? undefined,
      userId: shopper.userId,
    },
  });
  // Nothing to buy, or lines that need the buyer's attention first (§10.3 flags them).
  if (quote.lines.length === 0 || quote.lineIssues.length > 0) {
    return redirect({ href: '/cart', locale });
  }

  const data: CheckoutPageData = {
    locale,
    // Idempotency key of this checkout session: a repeated submit returns the first order.
    checkoutKey: randomBytes(18).toString('base64url'),
    provinces,
    savedAddresses,
    initialWards: saved ? { [saved.provinceCode]: await listWards(db, saved.provinceCode) } : {},
    quote,
    defaults: {
      email: shopper.email ?? '',
      phone: saved?.phone ?? shopper.phone ?? '',
      fullName: saved?.fullName ?? shopper.name ?? '',
      couponCode: cart.couponCode ?? '',
      savedAddressId: saved?.id ?? null,
      address: saved
        ? { provinceCode: saved.provinceCode, wardCode: saved.wardCode, street: saved.street }
        : { provinceCode: '', wardCode: '', street: '' },
    },
    signedIn: !!shopper.userId,
    links: {
      cart: getPathname({ locale, href: '/cart' }),
      signIn: getPathname({ locale, href: '/sign-in' }),
      terms: terms ? pagePath('terms', terms.slug, locale) : null,
      privacy: privacy ? pagePath('privacy', privacy.slug, locale) : null,
    },
  };
  return <CheckoutForm data={data} />;
}

function CheckoutSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16">
      <div className="flex flex-col gap-10">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="border-line-200 flex flex-col gap-5 border-t pt-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
