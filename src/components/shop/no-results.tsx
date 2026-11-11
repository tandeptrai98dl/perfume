import { SearchX } from 'lucide-react';
import type { Route } from 'next';
import NextLink from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** Empty listing or search with ways forward (§8.3). Copy comes from the caller. */
export function NoResults({
  title,
  description,
  clearHref,
  clearLabel,
  browseAllLabel,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  /** Same listing without filters, when filters are active. */
  clearHref?: string;
  clearLabel?: string;
  browseAllLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-10">
      <EmptyState
        icon={<SearchX aria-hidden />}
        title={title}
        description={description}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            {clearHref && clearLabel && (
              <Button asChild variant="primary">
                <NextLink href={clearHref as Route}>{clearLabel}</NextLink>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/perfumes">{browseAllLabel}</Link>
            </Button>
          </div>
        }
      />
      {children}
    </div>
  );
}
