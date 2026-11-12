import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { HomeBannerSlot } from '@/components/shop/home-banner-slot';
import { JournalTeaser } from '@/components/shop/journal-teaser';
import { JsonLd } from '@/components/shop/json-ld';
import { NewsletterSignup } from '@/components/shop/newsletter-signup-lazy';
import { ProductGrid } from '@/components/shop/product-card';
import { ProductRail } from '@/components/shop/product-rail';
import { TrustStrip } from '@/components/shop/trust-strip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getPostSummaries, getPolicyPath, visibleNow } from '@/data/content';
import { getSeoDefaults } from '@/data/settings';
import { getPathname, Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { localizedPath } from '@/lib/seo/paths';
import { getBestSellers, getFeatured, getHomeBrands, getNewArrivals } from '@/server/catalog-cache';
import { resolveLocale } from '@/app/[locale]/(shop)/_content/shared';

import { absoluteUrl, alternates, siteUrl } from './_lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  // APP_URL is read at request time (the build machine's URL must never be baked in).
  await connection();
  const t = await getTranslations({ locale, namespace: 'metadata' });
  // SEO defaults from admin settings (§11.2), the translated copy as fallback.
  const seo = await getSeoDefaults(locale);
  return {
    title: { absolute: `${t('siteName')} – ${seo.title ?? t('defaultTitle')}` },
    description: seo.description ?? t('defaultDescription'),
    alternates: alternates(locale, { vi: '/', en: '/' }),
  };
}

/**
 * Editorial home (§8.3): hero copy, CMS banners, trust strip, featured products, new arrivals
 * and best sellers rails, brands, journal teaser and newsletter sign-up. Data sections stream
 * at request time from the cached catalogue/content reads (`'use cache'` + tags).
 */
export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const locale = await resolveLocale(params);
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

      <Suspense fallback={<Skeleton className="h-40 w-full md:h-28" />}>
        <HomeTrustStrip locale={locale} />
      </Suspense>

      <section
        aria-labelledby="home-featured"
        className="container-content flex flex-col gap-10 py-(--spacing-section)"
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

      <HomeRail
        id="home-new"
        eyebrow={t('newEyebrow')}
        title={t('newTitle')}
        viewAll={{ label: t('viewAllNew'), sort: 'newest' }}
      >
        <NewArrivals locale={locale} label={t('newTitle')} />
      </HomeRail>

      <HomeBannerSlot locale={locale} placement="home_promo" />

      <HomeRail
        id="home-best"
        eyebrow={t('bestEyebrow')}
        title={t('bestTitle')}
        viewAll={{ label: t('viewAllBest'), sort: 'best_selling' }}
      >
        <BestSellers locale={locale} label={t('bestTitle')} />
      </HomeRail>

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

      <Suspense fallback={null}>
        <HomeJournal locale={locale} />
      </Suspense>

      <section aria-labelledby="home-newsletter" className="bg-sand-100">
        <div className="container-content grid gap-8 py-(--spacing-section) md:grid-cols-2 md:gap-12">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-gold-700">{t('newsletterEyebrow')}</p>
            <h2 id="home-newsletter" className="text-display-lg">
              {t('newsletterTitle')}
            </h2>
            <p className="text-taupe-600">{t('newsletterText')}</p>
          </div>
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <HomeNewsletter locale={locale} />
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

/** Section frame of a product rail with its "view all" link to the sorted listing. */
function HomeRail({
  id,
  eyebrow,
  title,
  viewAll,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  viewAll: { label: string; sort: 'newest' | 'best_selling' };
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="container-content flex flex-col gap-10 pb-(--spacing-section)"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-gold-700">{eyebrow}</p>
          <h2 id={id} className="text-display-lg">
            {title}
          </h2>
        </div>
        <Link
          href={{ pathname: '/perfumes', query: { sort: viewAll.sort } }}
          className="text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {viewAll.label}
        </Link>
      </div>
      <Suspense fallback={<GridSkeleton />}>{children}</Suspense>
    </section>
  );
}

async function NewArrivals({ locale, label }: { locale: Locale; label: string }) {
  await connection();
  const products = await getNewArrivals(locale, 8);
  if (products.length === 0) return null;
  return <ProductRail products={products} label={label} testId="rail-new" />;
}

async function BestSellers({ locale, label }: { locale: Locale; label: string }) {
  await connection();
  const products = await getBestSellers(locale, 8);
  if (products.length === 0) return null;
  return <ProductRail products={products} label={label} testId="rail-best" />;
}

async function HomeTrustStrip({ locale }: { locale: Locale }) {
  await connection();
  const [returns, delivery] = await Promise.all([
    getPolicyPath('returns', locale),
    getPolicyPath('shipping', locale),
  ]);
  return (
    <TrustStrip
      locale={locale}
      links={{ authentic: localizedPath(locale, '/authenticity'), returns, delivery }}
    />
  );
}

async function HomeJournal({ locale }: { locale: Locale }) {
  await connection();
  const posts = visibleNow(await getPostSummaries(locale)).slice(0, 3);
  return <JournalTeaser locale={locale} posts={posts} />;
}

async function HomeNewsletter({ locale }: { locale: Locale }) {
  await connection();
  const privacyHref = await getPolicyPath('privacy', locale);
  return <NewsletterSignup source="home" privacyHref={privacyHref} />;
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
