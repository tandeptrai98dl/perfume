'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { routing, type Locale } from '@/i18n/routing';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { useLocaleAlternates, type LocaleHref } from './locale-alternates';

/**
 * Plain links to the same page in each locale (crawlable, works without JS). The choice is
 * remembered by next-intl's NEXT_LOCALE cookie; there is no Accept-Language redirect (§3.6).
 *
 * Pages with per-locale slugs register the equivalent page through <SetLocaleAlternates>
 * (§10.7): the product's slug in the other locale, or the closest listing when it has no
 * translation there. Other pages reuse the current pathname and params.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const pathname = usePathname();
  const params = useParams();
  const alternates = useLocaleAlternates();
  return (
    <LocaleLinks
      className={className}
      // The router types the pathname/params pair; params come straight from the URL.
      hrefFor={(locale) => alternates?.[locale] ?? ({ pathname, params } as never)}
    />
  );
}

/**
 * Prerender-safe fallback (no URL hooks): links to each locale's home page. Pages with
 * runtime params render it in the static shell until the real switcher streams in.
 */
export function LanguageSwitcherFallback({ className }: { className?: string }) {
  return <LocaleLinks className={className} hrefFor={() => '/'} />;
}

function LocaleLinks({
  className,
  hrefFor,
}: {
  className?: string;
  hrefFor: (locale: Locale) => LocaleHref;
}) {
  const t = useTranslations('localeSwitcher');
  const current = useLocale();
  return (
    <nav aria-label={t('label')} className={cn('flex items-center gap-1', className)}>
      {routing.locales.map((locale: Locale, index) => (
        <span key={locale} className="inline-flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-taupe-300">
              /
            </span>
          )}
          <Link
            href={hrefFor(locale)}
            locale={locale}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === current ? 'true' : undefined}
            className={cn(
              'eyebrow hover:text-ink-950 inline-flex min-h-11 items-center px-1 text-taupe-600',
              locale === current && 'text-ink-950 underline underline-offset-4',
            )}
          >
            <span aria-hidden>{locale.toUpperCase()}</span>
            <span className="sr-only">{t(locale)}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}
