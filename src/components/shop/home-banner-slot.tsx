import type { CatalogLocale } from '@/server/modules/catalog';

/**
 * Integration point for home banners (stream C, `banners` with placement `home_hero` /
 * `home_promo`). Renders nothing until the CMS provides a component; replace the body with the
 * banner rail and keep the props.
 */
export function HomeBannerSlot({
  locale,
  placement,
}: {
  locale: CatalogLocale;
  placement: 'home_hero' | 'home_promo';
}) {
  void locale;
  void placement;
  return null;
}
