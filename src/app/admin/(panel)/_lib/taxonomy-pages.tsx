import { Plus } from 'lucide-react';
import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TaxonomyForm } from '@/components/admin/catalog/taxonomy-form';
import { TaxonomyTable } from '@/components/admin/catalog/taxonomy-table';
import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getTaxonomy, listTaxonomy, type TaxonomyKind } from '@/server/modules/catalog';

import { isUuid } from './params';

const BASE: Record<TaxonomyKind, string> = {
  family: '/admin/catalog/families',
  note: '/admin/catalog/notes',
};

/** Shared list screen of scent families and notes. */
export async function TaxonomyListContent({
  kind,
  searchParams,
}: {
  kind: TaxonomyKind;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.taxonomy' });
  const query = toListQuery(await loadTableParams(searchParams));
  const data = await listTaxonomy(getDb(), kind, query);
  return (
    <>
      <PageHeader
        title={t(`${kind}.title`)}
        description={t(`${kind}.description`)}
        actions={
          <Button asChild>
            <Link href={`${BASE[kind]}/new` as Route}>
              <Plus aria-hidden />
              {t(`${kind}.new`)}
            </Link>
          </Button>
        }
      />
      <TaxonomyTable
        kind={kind}
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}

/** Shared editor screen of a scent family or note (`new` creates). */
export async function TaxonomyEditContent({
  kind,
  params,
}: {
  kind: TaxonomyKind;
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage('products.editContent');
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.taxonomy' });
  const item = id === 'new' ? null : await getTaxonomy(getDb(), kind, id);
  if (id !== 'new' && !item) notFound();
  return (
    <>
      <PageHeader
        title={item?.translations.vi?.name ?? t(`${kind}.createTitle`)}
        back={{ href: BASE[kind], label: t(`${kind}.title`) }}
      />
      <TaxonomyForm kind={kind} item={item} appUrl={serverEnv().APP_URL} />
    </>
  );
}
