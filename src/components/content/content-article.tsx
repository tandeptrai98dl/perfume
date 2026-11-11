import type { ReactNode } from 'react';

import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Page frame for information pages, policies and journal posts (one h1, breadcrumb). */
export function ContentArticle({
  title,
  eyebrow,
  lead,
  meta,
  breadcrumbs,
  baseUrl,
  children,
  className,
}: {
  title: string;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
  breadcrumbs: BreadcrumbItem[];
  baseUrl: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn('container-content py-10 lg:py-16', className)}
      aria-labelledby="content-title"
    >
      <Breadcrumb items={breadcrumbs} baseUrl={baseUrl} className="mb-8" />
      <header className="mb-8 flex max-w-3xl flex-col gap-4 lg:mb-12">
        {eyebrow && <p className="eyebrow text-gold-700">{eyebrow}</p>}
        <h1 id="content-title" className="text-display-lg">
          {title}
        </h1>
        {lead && <p className="text-body-lg text-taupe-600">{lead}</p>}
        {meta && <div className="text-small text-taupe-600">{meta}</div>}
      </header>
      {children}
    </article>
  );
}

/** Same dimensions as `ContentArticle` while content streams in. */
export function ContentArticleSkeleton() {
  return (
    <div className="container-content py-10 lg:py-16" aria-hidden>
      <Skeleton className="mb-8 h-5 w-48" />
      <Skeleton className="mb-4 h-12 w-full max-w-2xl" />
      <Skeleton className="mb-12 h-6 w-full max-w-xl" />
      <div className="flex max-w-prose flex-col gap-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}
