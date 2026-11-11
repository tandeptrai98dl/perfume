import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { HomeBannerSlot } from '@/components/shop/home-banner-slot';
import { JsonLd } from '@/components/shop/json-ld';
import { ProductGrid } from '@/components/shop/product-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getPathname, Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getFeatured, getHomeBrands } from '@/server/catalog-cache';

import { absoluteUrl, alternates, siteUrl } from './_lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  // APP_URL is read at request time (the build machine's URL must never be baked in).
  await connection();
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: { absolute: `${t('siteName')} – ${t('defaultTitle')}` },
    description: t('defaultDescription'),
    alternates: alternates(locale, { vi: '/', en: '/' }),
  };
}

/**
 * Editorial home (§8.3): hero copy, CMS banners (stream C slot), featured products and the
 * brands rail. Catalogue sections stream at request time from the catalogue cache.
 */
export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'home' });
  return (
    <>
      <section className="container-content flex flex-col items-center gap-6 py-(--spacing-section) text-center lg:py-(--spacing-section-lg)">
        <p className="eyebrow text-gold-700">{t('eyebrow')}</p>
        <h1 className="text-display-xl max-w-3xl">{t('title')}</h1>
        <p className="text-body-lg max-w-xl text-taupe-600">{t('subtitle')}</p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/perfumes">{t('cta')}</Link>
        </Button>
      </section>

      <HomeBannerSlot locale={locale} placement="home_hero" />

      <section
        aria-labelledby="home-featured"
        className="container-content flex flex-col gap-10 pb-(--spacing-section)"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="eyebrow text-gold-700">{t('featuredEyebrow')}</p>
            <h2 id="home-featured" className="text-display-lg">
              {t('featuredTitle')}
            </h2>
          </div>
          <Link
            href="/perfumes"
            className="text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {t('viewAllProducts')}
          </Link>
        </div>
        <Suspense fallback={<GridSkeleton />}>
          <FeaturedProducts locale={locale} />
        </Suspense>
      </section>

      <HomeBannerSlot locale={locale} placement="home_promo" />

      <section aria-labelledby="home-brands" className="bg-sand-100">
        <div className="container-content flex flex-col gap-10 py-(--spacing-section)">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <p className="eyebrow text-gold-700">{t('brandsEyebrow')}</p>
              <h2 id="home-brands" className="text-display-lg">
                {t('brandsTitle')}
              </h2>
            </div>
            <Link
              href="/brands"
              className="text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {t('viewAllBrands')}
            </Link>
          </div>
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <BrandsRail locale={locale} />
          </Suspense>
        </div>
      </section>

      <Suspense>
        <HomeJsonLd locale={locale} />
      </Suspense>
    </>
  );
}

async function FeaturedProducts({ locale }: { locale: Locale }) {
  await connection();
  const t = await getTranslations({ locale, namespace: 'home' });
  const products = await getFeatured(locale, 8);
  if (products.length === 0) return <p className="text-taupe-600">{t('featuredEmpty')}</p>;
  return <ProductGrid products={products} headingLevel="h3" priorityCount={2} />;
}

async function BrandsRail({ locale }: { locale: Locale }) {
  await connection();
  const brands = await getHomeBrands(locale);
  if (brands.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-12 gap-y-6">
      {brands.map((brand) => (
        <li key={brand.id}>
          <Link
            href={{ pathname: '/brands/[slug]', params: { slug: brand.slug } }}
            className="font-display text-h2 hover:text-gold-700 inline-flex min-h-11 items-center"
          >
            {brand.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Organization + WebSite with SearchAction (§13.1). */
async function HomeJsonLd({ locale }: { locale: Locale }) {
  await connection();
  const t = await getTranslations({ locale, namespace: 'metadata' });
  const home = absoluteUrl(locale, '/');
  const search = `${siteUrl()}${getPathname({ locale, href: '/search' })}`;
  return (
    <JsonLd
      data={[
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: t('siteName'),
          url: `${siteUrl()}/`,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: t('siteName'),
          url: home,
          inLanguage: locale,
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${search}?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        },
      ]}
    />
  );
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <Skeleton className="aspect-[4/5] w-full" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
