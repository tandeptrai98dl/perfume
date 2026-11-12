import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { SetLocaleAlternates, type LocaleAlternates } from '@/components/layout/locale-alternates';
import { AddToCart } from '@/components/shop/add-to-cart';
import { AuthenticityBadge } from '@/components/shop/authenticity-badge';
import { BrandStoryBlock } from '@/components/shop/brand-story-block';
import { ComplianceInfo } from '@/components/shop/compliance-info';
import { FragrancePyramid } from '@/components/shop/fragrance-pyramid';
import { JsonLd } from '@/components/shop/json-ld';
import { ProductGallery } from '@/components/shop/product-gallery';
import { ProductLineSwitcher } from '@/components/shop/product-line-switcher';
import { RelatedProducts } from '@/components/shop/related-products';
import { ReviewsSection } from '@/components/shop/reviews/reviews-section';
import { RichText, hasRichText } from '@/components/shop/rich-text';
import { ScentProfile } from '@/components/shop/scent-profile';
import { VariantSelector } from '@/components/shop/variant-selector';
import { ProductVariantProvider } from '@/components/shop/variant-store';
import { WishlistButton } from '@/components/shop/wishlist-button';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';
import { getPathname, Link } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { mediaUrl } from '@/lib/media-url';
import { getProduct, getRelated } from '@/server/catalog-cache';
import { getDb } from '@/server/db/client';
import { getVariantOffers, type ProductDetail, type VariantOffer } from '@/server/modules/catalog';
import { getCommerceSettings } from '@/server/modules/settings';
import { getProductReviews, getProductReviewSummary } from '@/server/review-cache';

import {
  absoluteUrl,
  alternates,
  fitTitle,
  placeholderParams,
  siteUrl,
  truncate,
  type PageHref,
} from '../../_lib/seo';

function productHrefs(product: ProductDetail): Partial<Record<Locale, PageHref>> {
  return Object.fromEntries(
    routing.locales
      .filter((locale) => product.localeSlugs[locale])
      .map((locale) => [
        locale,
        { pathname: '/products/[slug]', params: { slug: product.localeSlugs[locale]! } },
      ]),
  );
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/products/[slug]'>): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  const product = await getProduct(locale, slug);
  if (!product) return {};
  const t = await getTranslations({ locale });
  const concentration = t(`catalog.concentration.${product.concentration}`);
  const shortConcentration = t(`catalog.concentrationShort.${product.concentration}`);
  const name = product.name.toLowerCase().includes(shortConcentration.toLowerCase())
    ? product.name
    : `${product.name} ${shortConcentration}`;
  const title =
    product.seoTitle ?? fitTitle(name, `${product.brand.name} – ${t('metadata.siteName')}`);
  const description = truncate(
    product.seoDescription ??
      t('product.metaDescription', {
        name: product.name,
        concentration,
        brand: product.brand.name,
      }),
  );
  return {
    // Canonical never includes ?v= (§13.1).
    title: { absolute: title },
    description,
    alternates: alternates(locale, productHrefs(product)),
    openGraph: {
      type: 'website',
      title,
      description,
      locale: locale === 'vi' ? 'vi_VN' : 'en_GB',
      url: absoluteUrl(locale, { pathname: '/products/[slug]', params: { slug: product.slug } }),
      // The image is the generated card in ./opengraph-image.tsx (file convention wins).
    },
  };
}

export const generateStaticParams = placeholderParams;
/** The page awaits its slug outside Suspense on purpose (see PLACEHOLDER_SLUG). */
export const instant = false;

export default async function ProductPage({ params }: PageProps<'/[locale]/products/[slug]'>) {
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale as Locale;
  const product = await getProduct(locale, slug);
  if (!product) notFound();

  const t = await getTranslations({ locale });
  const related = await getRelated(locale, product.id);
  const hrefs = productHrefs(product);
  // Without a translation in the other locale, switch to the closest listing (§10.7).
  const switcher: LocaleAlternates = Object.fromEntries(
    routing.locales.map((target) => [target, hrefs[target] ?? '/perfumes']),
  );
  const defaultVariant =
    product.variants.find((variant) => variant.isDefault) ?? product.variants[0];
  const countryName = product.compliance.countryOfOrigin
    ? (new Intl.DisplayNames([locale], { type: 'region' }).of(product.compliance.countryOfOrigin) ??
      product.compliance.countryOfOrigin)
    : null;
  const primaryCategory = product.categories[0];

  return (
    <ProductVariantProvider defaultSku={defaultVariant?.sku ?? null}>
      <SetLocaleAlternates alternates={switcher} />
      <article className="container-content flex flex-col gap-16 py-8 lg:gap-24 lg:py-12">
        <div className="flex flex-col gap-6">
          <Breadcrumb
            baseUrl={siteUrl()}
            items={[
              { name: t('navigation.home'), href: getPathname({ locale, href: '/' }) },
              primaryCategory
                ? {
                    name: primaryCategory.name,
                    href: getPathname({
                      locale,
                      href: {
                        pathname: '/categories/[slug]',
                        params: { slug: primaryCategory.slug },
                      },
                    }),
                  }
                : {
                    name: t('navigation.perfumes'),
                    href: getPathname({ locale, href: '/perfumes' }),
                  },
              { name: product.name },
            ]}
          />
          <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
            <ProductGallery
              images={product.images}
              productName={product.name}
              variantIdsBySku={Object.fromEntries(
                product.variants.map((variant) => [variant.sku, variant.id]),
              )}
            />
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                {product.brand.slug ? (
                  <Link
                    href={{ pathname: '/brands/[slug]', params: { slug: product.brand.slug } }}
                    className="eyebrow text-gold-700 inline-flex min-h-11 items-center self-start hover:underline"
                  >
                    {product.brand.name}
                  </Link>
                ) : (
                  <p className="eyebrow text-gold-700">{product.brand.name}</p>
                )}
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-h1">{product.name}</h1>
                  <WishlistButton
                    productId={product.id}
                    productName={product.name}
                    productSlug={product.slug}
                    variant="outline"
                    className="shrink-0"
                  />
                </div>
                {product.subtitle && (
                  <p className="text-body-lg text-taupe-600">{product.subtitle}</p>
                )}
                <p className="text-small text-taupe-600">
                  {t(`catalog.concentration.${product.concentration}`)}
                </p>
              </div>
              <ProductLineSwitcher siblings={product.siblings} />
              <Suspense fallback={<OfferSkeleton />}>
                <PurchasePanel product={product} locale={locale} />
              </Suspense>
              <AuthenticityBadge />
              <p className="text-small text-taupe-600">{t('product.returns')}</p>
            </div>
          </div>
        </div>

        {hasRichText(product.description) && (
          <section aria-labelledby="product-description" className="flex max-w-3xl flex-col gap-6">
            <h2 id="product-description" className="text-h2">
              {t('product.description')}
            </h2>
            <RichText doc={product.description} className="text-body-lg" />
          </section>
        )}

        <div className="grid gap-16 lg:grid-cols-2">
          <section aria-labelledby="product-pyramid" className="flex flex-col gap-6">
            <h2 id="product-pyramid" className="text-h2">
              {t('product.pyramid.title')}
            </h2>
            <FragrancePyramid notes={product.notes} />
          </section>
          <section aria-labelledby="product-profile" className="flex flex-col gap-6">
            <h2 id="product-profile" className="text-h2">
              {t('product.profile.title')}
            </h2>
            <ScentProfile product={product} />
          </section>
        </div>

        <section aria-labelledby="product-compliance" className="flex flex-col gap-6">
          <h2 id="product-compliance" className="text-h2">
            {t('product.compliance.title')}
          </h2>
          <ComplianceInfo compliance={product.compliance} countryName={countryName} />
        </section>

        <Suspense fallback={<ReviewsSkeleton />}>
          <ProductReviews productId={product.id} locale={locale} />
        </Suspense>

        <BrandStoryBlock brand={product.brand} />
        <RelatedProducts products={related} />
      </article>
    </ProductVariantProvider>
  );
}

const AVAILABILITY: Record<VariantOffer['stockState'], string> = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
};

/** Live price and stock (never cached, §14.1) plus Product JSON-LD built from the same data. */
async function PurchasePanel({ product, locale }: { product: ProductDetail; locale: Locale }) {
  await connection();
  const [offers, settings, reviewSummary] = await Promise.all([
    getVariantOffers(product.id),
    getCommerceSettings(getDb()),
    getProductReviewSummary(product.id),
  ]);
  const byId = new Map(offers.map((offer) => [offer.variantId, offer]));
  const variants = product.variants.flatMap((variant) => {
    const offer = byId.get(variant.id);
    return offer ? [{ ...variant, offer }] : [];
  });

  const url = absoluteUrl(locale, { pathname: '/products/[slug]', params: { slug: product.slug } });
  const offerLd = variants.map((variant) => ({
    '@type': 'Offer',
    sku: variant.sku,
    ...(variant.barcode ? { gtin: variant.barcode } : {}),
    price: variant.offer.price,
    priceCurrency: 'VND',
    availability: AVAILABILITY[variant.offer.stockState],
    itemCondition: 'https://schema.org/NewCondition',
    url: `${url}?v=${encodeURIComponent(variant.sku)}`,
  }));
  const prices = variants.map((variant) => variant.offer.price);
  const images = product.images
    .map((image) => mediaUrl(image.storageKey, image.url))
    .filter((src): src is string => Boolean(src));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    ...(product.subtitle || product.seoDescription
      ? { description: product.seoDescription ?? product.subtitle }
      : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(variants.length === 1 ? { sku: variants[0]!.sku } : {}),
    brand: { '@type': 'Brand', name: product.brand.name },
    ...(variants.length === 0
      ? {}
      : variants.length === 1
        ? { offers: offerLd[0] }
        : {
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: 'VND',
              lowPrice: Math.min(...prices),
              highPrice: Math.max(...prices),
              offerCount: variants.length,
              offers: offerLd,
            },
          }),
    // Only when approved reviews exist (ADR-0008).
    ...(reviewSummary.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: reviewSummary.average,
            reviewCount: reviewSummary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  return (
    <>
      <VariantSelector variants={variants} />
      <div data-slot="add-to-cart">
        <AddToCart
          variants={variants.map((variant) => variant.offer)}
          maxQuantityPerLine={settings.cart.maxQuantityPerLine}
        />
      </div>
      <JsonLd data={jsonLd} />
    </>
  );
}

/** Approved reviews (cached per product, refreshed by moderation). */
async function ProductReviews({ productId, locale }: { productId: string; locale: Locale }) {
  const [summary, page] = await Promise.all([
    getProductReviewSummary(productId),
    getProductReviews(productId, locale, 1),
  ]);
  return <ReviewsSection productId={productId} locale={locale} summary={summary} page={page} />;
}

function ReviewsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function OfferSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-5 w-28" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
      </div>
      <Skeleton className="h-13 w-full" />
    </div>
  );
}
