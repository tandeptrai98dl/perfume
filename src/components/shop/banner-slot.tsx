import { getLocale } from 'next-intl/server';
import Link from 'next/link';
import type { Route } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Image } from '@/components/ui/image';
import { Skeleton } from '@/components/ui/skeleton';
import { getLiveBanners } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import type { BannerPlacement, BannerView } from '@/server/modules/content';

/**
 * Renders the live banners of a placement (§11.2 content: banners per placement with schedule).
 * Usage: `<BannerSlot placement="home_hero" headingLevel="h1" />` on the home page,
 * `<BannerSlot placement="category_top" />` on listings. Renders nothing when no banner is live.
 * The announcement placement has its own component (`AnnouncementBar`).
 */
export function BannerSlot({
  placement,
  headingLevel = 'h2',
  className,
}: {
  placement: Exclude<BannerPlacement, 'announcement'>;
  headingLevel?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <Suspense
      fallback={
        placement === 'home_hero' ? (
          <Skeleton className="aspect-[4/5] w-full md:aspect-video" />
        ) : null
      }
    >
      <BannerSlotContent placement={placement} headingLevel={headingLevel} className={className} />
    </Suspense>
  );
}

async function BannerSlotContent({
  placement,
  headingLevel,
  className,
}: {
  placement: Exclude<BannerPlacement, 'announcement'>;
  headingLevel: 'h1' | 'h2';
  className?: string;
}) {
  await connection();
  const locale = (await getLocale()) as Locale;
  const banners = await getLiveBanners(placement, locale);
  if (banners.length === 0) return null;

  if (placement === 'home_hero') {
    return <HeroBanner banner={banners[0]!} headingLevel={headingLevel} className={className} />;
  }
  return (
    <section className={cn('container-content grid gap-6 md:grid-cols-2', className)}>
      {banners.map((banner) => (
        <PromoBanner key={banner.id} banner={banner} />
      ))}
    </section>
  );
}

function BannerCta({ banner, inverted }: { banner: BannerView; inverted: boolean }) {
  if (!banner.ctaLabel || !banner.ctaUrl) return null;
  const className = cn(
    'text-button inline-flex min-h-11 items-center justify-center border px-6 font-medium uppercase transition-colors duration-(--duration-hover)',
    inverted
      ? 'border-ivory-50 text-ivory-50 hover:bg-ivory-50 hover:text-ink-950'
      : 'border-ink-950 text-ink-950 hover:bg-ink-950 hover:text-ivory-50',
  );
  if (/^https?:\/\//.test(banner.ctaUrl)) {
    return (
      <a href={banner.ctaUrl} className={className} target="_blank" rel="noopener noreferrer">
        {banner.ctaLabel}
      </a>
    );
  }
  return (
    <Link href={banner.ctaUrl as Route} className={className}>
      {banner.ctaLabel}
    </Link>
  );
}

/** Art-directed hero: mobile image below md, desktop image above (falls back to each other). */
export function HeroBanner({
  banner,
  headingLevel = 'h2',
  className,
}: {
  banner: BannerView;
  headingLevel?: 'h1' | 'h2';
  className?: string;
}) {
  const Heading = headingLevel;
  const desktop = banner.desktopMedia ?? banner.mobileMedia;
  const mobile = banner.mobileMedia ?? banner.desktopMedia;
  const hasImage = Boolean(desktop);
  return (
    <section className={cn('relative isolate overflow-hidden', className)}>
      {mobile && (
        <Image
          src={mobile.url}
          alt=""
          ratio="4/5"
          priority
          sizes="100vw"
          frameClassName="md:hidden"
        />
      )}
      {desktop && (
        <Image
          src={desktop.url}
          alt=""
          ratio="16/9"
          priority
          sizes="100vw"
          frameClassName="hidden md:block"
        />
      )}
      <div
        className={cn(
          'flex flex-col items-start justify-end gap-4 p-6 md:p-12 lg:p-16',
          hasImage
            ? 'bg-overlay text-ivory-50 absolute inset-0'
            : 'bg-sand-100 text-ink-950 min-h-[50dvh]',
        )}
      >
        <Heading className="text-display-lg max-w-2xl">{banner.title}</Heading>
        {banner.subtitle && <p className="text-body-lg max-w-xl">{banner.subtitle}</p>}
        <BannerCta banner={banner} inverted={hasImage} />
      </div>
    </section>
  );
}

function PromoBanner({ banner }: { banner: BannerView }) {
  const image = banner.desktopMedia ?? banner.mobileMedia;
  return (
    <article className="bg-sand-100 flex flex-col">
      {image && <Image src={image.url} alt="" ratio="3/2" sizes="(min-width: 768px) 50vw, 100vw" />}
      <div className="flex flex-col items-start gap-3 p-6">
        <h2 className="text-h3">{banner.title}</h2>
        {banner.subtitle && <p className="text-taupe-600">{banner.subtitle}</p>}
        <BannerCta banner={banner} inverted={false} />
      </div>
    </article>
  );
}
