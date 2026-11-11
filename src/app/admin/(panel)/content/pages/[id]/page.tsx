import { notFound } from 'next/navigation';

import { PageForm } from '@/components/admin/content/page-form';
import { translationValues } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { getPageForAdmin } from '@/server/modules/content';

import { idParam, PageHeader, requireContentAdmin } from '../../_shared';

export default async function EditPagePage({ params }: PageProps<'/admin/content/pages/[id]'>) {
  const t = await requireContentAdmin();
  const id = await idParam(params);
  const page = await getPageForAdmin(getDb(), id);
  if (!page) notFound();
  return (
    <section>
      <PageHeader
        title={page.translations.vi?.title ?? page.key}
        back={{ href: '/admin/content/pages', label: t('sections.pages.title') }}
      />
      <PageForm
        id={page.id}
        defaultValues={{
          key: page.key,
          status: page.status,
          hasEn: Boolean(page.translations.en),
          translations: {
            vi: translationValues(page.translations.vi),
            en: translationValues(page.translations.en),
          },
        }}
      />
    </section>
  );
}
