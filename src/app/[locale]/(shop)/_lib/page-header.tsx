import type { ReactNode } from 'react';

import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb';

import { siteUrl } from './seo';

/** Breadcrumb (with BreadcrumbList JSON-LD), eyebrow, h1 and intro of a listing page. */
export function ListingHeader({
  breadcrumbs,
  eyebrow,
  title,
  intro,
}: {
  breadcrumbs: BreadcrumbItem[];
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <Breadcrumb items={breadcrumbs} baseUrl={siteUrl()} />
      {eyebrow && <p className="eyebrow text-gold-700">{eyebrow}</p>}
      <h1 className="text-h1">{title}</h1>
      {intro && <div className="text-body-lg max-w-3xl text-taupe-600">{intro}</div>}
    </header>
  );
}
