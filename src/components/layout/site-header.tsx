import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

import { SkipLink } from '@/components/ui/skip-link';
import { Link } from '@/i18n/navigation';

import { LanguageSwitcher } from './language-switcher';

type NavItem = {
  href: '/perfumes' | '/brands' | '/journal';
  key: 'perfumes' | 'brands' | 'journal';
};
type ActionItem = {
  href: '/search' | '/account' | '/cart';
  key: 'search' | 'account' | 'cart';
  icon: LucideIcon;
};

/**
 * Only routes that exist are linked (no links to 404s). M1 adds entries as pages ship:
 * perfumes, brands, journal; actions: search (Search), account (User), cart (ShoppingBag).
 */
const NAV: readonly NavItem[] = [{ href: '/journal', key: 'journal' }];
const ACTIONS: readonly ActionItem[] = [];

/** Storefront header (§8.2). Mega menu, search dialog, mini-cart and mobile nav arrive in M1. */
export function SiteHeader() {
  const t = useTranslations();
  const iconLink =
    'inline-flex size-11 items-center justify-center text-ink-950 hover:bg-sand-100 [&_svg]:size-5';

  return (
    <>
      <SkipLink />
      <header className="border-line-200 bg-ivory-50 border-b">
        <div className="mx-auto flex max-w-(--container-wide) items-center justify-between gap-2 px-4 py-3 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-4 md:px-6">
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
            {/* Dynamic routes ([slug]) only know the pathname at request time. */}
            <Suspense
              fallback={<span aria-hidden className="inline-block min-h-11 w-16 md:mr-2" />}
            >
              <LanguageSwitcher className="md:mr-2" />
            </Suspense>
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
