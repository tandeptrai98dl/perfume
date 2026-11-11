import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { Route } from 'next';

import { cn } from '@/lib/utils';

export type BreadcrumbItem = { name: string; href?: string };

/**
 * Breadcrumb trail plus BreadcrumbList JSON-LD (§8.1, §13). The last item is the current page.
 * `baseUrl` makes JSON-LD URLs absolute.
 */
export function Breadcrumb({
  items,
  baseUrl,
  className,
}: {
  items: BreadcrumbItem[];
  baseUrl: string;
  className?: string;
}) {
  const t = useTranslations('ui');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.href ? { item: new URL(item.href, baseUrl).toString() } : {}),
    })),
  };

  return (
    <nav aria-label={t('breadcrumb')} className={cn('text-small text-taupe-600', className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.name}-${index}`} className="inline-flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href as Route} className="hover:text-ink-950 hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'text-ink-950' : undefined}
                >
                  {item.name}
                </span>
              )}
              {!last && <ChevronRight aria-hidden className="size-3.5" />}
            </li>
          );
        })}
      </ol>
      <script
        type="application/ld+json"
        // JSON.stringify output with "<" escaped cannot break out of the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </nav>
  );
}
