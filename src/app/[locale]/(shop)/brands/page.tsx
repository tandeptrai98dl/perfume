import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { getPathname, Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { foldVietnamese } from '@/lib/text';
import { getBrands } from '@/server/catalog-cache';
import type { BrandListItem } from '@/server/modules/catalog';
import { resolveLocale } from '@/app/[locale]/(shop)/_content/shared';

import { ListingHeader } from '../_lib/page-header';
import { alternates, truncate } from '../_lib/seo';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/brands'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  await connection();
  const t = await getTranslations({ locale, namespace: 'listing' });
  return {
    title: t('brandsTitle'),
    description: truncate(t('brandsDescription')),
    alternates: alternates(locale, { vi: '/brands', en: '/brands' }),
  };
}

export default async function BrandsPage({ params }: PageProps<'/[locale]/brands'>) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'listing' });
  return (
    <div className="container-content flex flex-col gap-12 py-10 lg:py-16">
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-5 w-40" />
            <h1 className="text-h1">{t('brandsTitle')}</h1>
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <BrandsContent locale={locale} />
      </Suspense>
    </div>
  );
}

function initialOf(name: string): string {
  const letter = foldVietnamese(name).charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
}

async function BrandsContent({ locale }: { locale: Locale }) {
  await connection();
  const t = await getTranslations({ locale });
  const brands = (await getBrands(locale)).filter((brand) => brand.productCount > 0);
  const groups = new Map<string, BrandListItem[]>();
  for (const brand of brands) {
    const letter = initialOf(brand.name);
    groups.set(letter, [...(groups.get(letter) ?? []), brand]);
  }

  return (
    <>
      <ListingHeader
        breadcrumbs={[
          { name: t('navigation.home'), href: getPathname({ locale, href: '/' }) },
          { name: t('navigation.brands') },
        ]}
        title={t('listing.brandsTitle')}
        intro={<p>{t('listing.brandsIntro')}</p>}
      />
      {brands.length === 0 ? (
        <p className="text-taupe-600">{t('listing.brandsEmpty')}</p>
      ) : (
        <>
          <nav aria-label={t('listing.brandsIndex')}>
            <ul className="flex flex-wrap gap-1">
              {[...groups.keys()].map((letter) => (
                <li key={letter}>
                  <a
                    href={`#brands-${letter}`}
                    className="hover:bg-sand-100 font-display inline-flex size-11 items-center justify-center text-xl"
                  >
                    {letter}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-12">
            {[...groups.entries()].map(([letter, items]) => (
              <section
                key={letter}
                id={`brands-${letter}`}
                aria-labelledby={`brands-${letter}-title`}
                className="border-line-200 grid gap-6 border-t pt-6 md:grid-cols-[6rem_1fr]"
              >
                <h2 id={`brands-${letter}-title`} className="text-display-lg text-gold-700">
                  {letter}
                </h2>
                <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((brand) => (
                    <li key={brand.id}>
                      <Link
                        href={{ pathname: '/brands/[slug]', params: { slug: brand.slug } }}
                        className="group flex flex-col"
                      >
                        <span className="font-display text-h3 group-hover:underline group-hover:underline-offset-4">
                          {brand.name}
                        </span>
                        <span className="text-small text-taupe-600">
                          {t('listing.brandProductCount', { count: brand.productCount })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
