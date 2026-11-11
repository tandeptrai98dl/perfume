import { X } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

/** One removable filter value; `href` is the listing URL without it. */
export type FilterChip = { key: string; label: string; href: string };

/**
 * Active filters as links (work without JavaScript): each removes one value, the last one
 * clears everything (§8.3).
 */
export function ActiveFilterChips({
  chips,
  clearHref,
}: {
  chips: FilterChip[];
  clearHref: string;
}) {
  const t = useTranslations('listing.filters');
  if (chips.length === 0) return null;
  return (
    <nav aria-label={t('active')}>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href as Route}
              scroll={false}
              aria-label={t('remove', { label: chip.label })}
              className="border-line-200 hover:border-ink-950 text-small inline-flex min-h-11 items-center gap-2 border px-3"
            >
              {chip.label}
              <X aria-hidden className="size-3.5" />
            </Link>
          </li>
        ))}
        {chips.length > 1 && (
          <li>
            <Link
              href={clearHref as Route}
              scroll={false}
              className="text-small text-gold-700 inline-flex min-h-11 items-center px-2 underline underline-offset-4"
            >
              {t('clearAll')}
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
