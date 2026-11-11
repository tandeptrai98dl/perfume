import { PageForm } from '@/components/admin/content/page-form';
import { emptyTranslation } from '@/components/admin/content/values';

import { PageHeader, requireContentAdmin } from '../../_shared';

export default async function NewPagePage() {
  const t = await requireContentAdmin();
  return (
    <section>
      <PageHeader
        title={t('sections.pages.new')}
        back={{ href: '/admin/content/pages', label: t('sections.pages.title') }}
      />
      <PageForm
        defaultValues={{
          key: '',
          status: 'draft',
          hasEn: false,
          translations: { vi: emptyTranslation(), en: emptyTranslation() },
        }}
      />
    </section>
  );
}
