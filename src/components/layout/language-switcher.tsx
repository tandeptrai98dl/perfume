'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { routing, type Locale } from '@/i18n/routing';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Plain links to the same page in each locale (crawlable, works without JS). The choice is
 * remembered by next-intl's NEXT_LOCALE cookie; there is no Accept-Language redirect (§3.6).
 *
 * Pages whose slugs differ per locale (products, journal) will provide their alternates
 * in M1; until then the current params are reused.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('localeSwitcher');
  const current = useLocale();
  const pathname = usePathname();
  const params = useParams();

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
            // The router types the pathname/params pair; params come straight from the URL.
            href={{ pathname, params } as never}
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
