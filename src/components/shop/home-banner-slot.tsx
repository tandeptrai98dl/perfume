import { BannerSlot } from '@/components/shop/banner-slot';
import type { CatalogLocale } from '@/server/modules/catalog';

/**
 * Home banners from the CMS (`banners` with placement `home_hero` / `home_promo`). Renders
 * nothing when no banner is live. The home page keeps its own h1, so banners use h2.
 */
export function HomeBannerSlot({
  placement,
}: {
  locale: CatalogLocale;
  placement: 'home_hero' | 'home_promo';
}) {
  return <BannerSlot placement={placement} headingLevel="h2" />;
}
