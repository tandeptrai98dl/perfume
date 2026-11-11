import { Search, ShoppingBag, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SkipLink } from '@/components/ui/skip-link';
import { Link } from '@/i18n/navigation';

import { LanguageSwitcher } from './language-switcher';

const NAV = [
  { href: '/perfumes', key: 'perfumes' },
  { href: '/brands', key: 'brands' },
  { href: '/journal', key: 'journal' },
] as const;

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
            <LanguageSwitcher className="md:mr-2" />
            <Link href="/search" className={iconLink} aria-label={t('navigation.search')}>
              <Search aria-hidden />
            </Link>
            <Link
              href="/account"
              className={`${iconLink} max-sm:hidden`}
              aria-label={t('navigation.account')}
            >
              <User aria-hidden />
            </Link>
            <Link href="/cart" className={iconLink} aria-label={t('navigation.cart')}>
              <ShoppingBag aria-hidden />
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
