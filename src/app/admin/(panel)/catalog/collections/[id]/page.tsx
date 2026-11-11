import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { CollectionForm } from '@/components/admin/catalog/collection-form';
import { CollectionProducts } from '@/components/admin/catalog/collection-products';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getCollection } from '@/server/modules/catalog';

import { isUuid } from '../../../_lib/params';

export default function AdminCollectionPage(props: PageProps<'/admin/catalog/collections/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/catalog/collections/[id]'>) {
  await requireAdminPage('products.editContent');
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.collections' });
  const collection = id === 'new' ? null : await getCollection(getDb(), id);
  if (id !== 'new' && !collection) notFound();
  return (
    <>
      <PageHeader
        title={collection?.translations.vi?.name ?? t('createTitle')}
        back={{ href: '/admin/catalog/collections', label: t('title') }}
      />
      <div className="flex flex-col gap-12">
        <CollectionForm
          key={collection?.updatedAt.toISOString() ?? 'new'}
          collection={collection}
          appUrl={serverEnv().APP_URL}
        />
        {collection ? (
          <CollectionProducts
            key={collection.products.map((p) => p.id).join()}
            collectionId={collection.id}
            initial={collection.products}
          />
        ) : (
          <p className="text-small text-taupe-600">{t('products.saveFirst')}</p>
        )}
      </div>
    </>
  );
}
