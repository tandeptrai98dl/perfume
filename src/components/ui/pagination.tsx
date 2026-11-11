import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { Route } from 'next';

import { pageWindow } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/** Link-based pagination (crawlable, works without JS). */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const t = useTranslations('ui.pagination');
  if (totalPages <= 1) return null;
  const cell = 'inline-flex size-11 items-center justify-center tabular-nums hover:bg-sand-100';

  return (
    <nav aria-label={t('label')} className={cn('flex justify-center', className)}>
      <ul className="flex items-center gap-1">
        <li>
          {page > 1 ? (
            <Link
              href={hrefFor(page - 1) as Route}
              rel="prev"
              className={cell}
              aria-label={t('previous')}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          ) : (
            <span className={cn(cell, 'opacity-40')} aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
        </li>
        {pageWindow(page, totalPages).map((item, index) =>
          item === null ? (
            <li key={`gap-${index}`} aria-hidden className="px-1 text-taupe-600">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item) as Route}
                aria-current={item === page ? 'page' : undefined}
                aria-label={t('page', { page: item })}
                className={cn(cell, item === page && 'border-ink-950 border')}
              >
                {item}
              </Link>
            </li>
          ),
        )}
        <li>
          {page < totalPages ? (
            <Link
              href={hrefFor(page + 1) as Route}
              rel="next"
              className={cell}
              aria-label={t('next')}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span className={cn(cell, 'opacity-40')} aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
