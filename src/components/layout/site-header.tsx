import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

import { SearchDialog } from '@/components/shop/search-dialog';
import { SkipLink } from '@/components/ui/skip-link';
import { Link } from '@/i18n/navigation';

import { LanguageSwitcher, LanguageSwitcherFallback } from './language-switcher';
import { MobileNav, type MobileNavItem } from './mobile-nav';

type NavItem = {
  href: '/perfumes' | '/brands' | '/journal';
  key: 'perfumes' | 'brands' | 'journal';
};
type ActionItem = {
  href: '/account' | '/cart';
  key: 'account' | 'cart';
  icon: LucideIcon;
};

/**
 * Only routes that exist are linked (no links to 404s). Add entries as pages ship:
 * journal (stream C); actions: account (User), cart (ShoppingBag) in M2. Search is the
 * SearchDialog (Ctrl/⌘+K), which falls back to a link to /search without JavaScript.
 */
const NAV: readonly NavItem[] = [
  { href: '/perfumes', key: 'perfumes' },
  { href: '/brands', key: 'brands' },
];
const ACTIONS: readonly ActionItem[] = [];
const MOBILE_NAV: readonly MobileNavItem[] = [
  { href: '/perfumes', key: 'perfumes' },
  { href: '/brands', key: 'brands' },
  { href: '/search', key: 'search' },
];

/** Storefront header (§8.2). Mega menu and mini-cart arrive later. */
export function SiteHeader() {
  const t = useTranslations();
  const iconLink =
    'inline-flex size-11 items-center justify-center text-ink-950 hover:bg-sand-100 [&_svg]:size-5';

  return (
    <>
      <SkipLink />
      <header className="border-line-200 bg-ivory-50 border-b">
        <div className="mx-auto flex max-w-(--container-wide) items-center justify-between gap-2 px-4 py-3 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-4 md:px-6">
          <MobileNav items={MOBILE_NAV} />
          <nav aria-label={t('footer.primaryNav')} className="hidden items-center gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="eyebrow hover:text-gold-700 inline-flex min-h-11 items-center"
              >
                {t(`navigation.${item.key}`)}
              </Link>
            ))}
          </nav>
          <Link
            href="/"
            className="font-display text-h3 md:text-h2 tracking-wide whitespace-nowrap md:col-start-2"
          >
            {t('metadata.siteName')}
          </Link>
          <div className="flex items-center justify-end md:col-start-3 md:gap-1">
            {/* Reads the URL, so it streams in on routes with runtime params. */}
            <Suspense fallback={<LanguageSwitcherFallback className="md:mr-2" />}>
              <LanguageSwitcher className="md:mr-2" />
            </Suspense>
            <SearchDialog triggerClassName={iconLink} />
            {ACTIONS.map(({ href, key, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                className={key === 'account' ? `${iconLink} max-sm:hidden` : iconLink}
                aria-label={t(`navigation.${key}`)}
              >
                <Icon aria-hidden />
              </Link>
            ))}
          </div>
        </div>
      </header>
    </>
  );
}
