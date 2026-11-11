import { TopicForm } from '@/components/admin/content/topic-form';
import { emptyTranslation } from '@/components/admin/content/values';

import { PageHeader, requireContentAdmin } from '../../_shared';

export default async function NewTopicPage() {
  const t = await requireContentAdmin();
  return (
    <section>
      <PageHeader
        title={t('sections.topics.new')}
        back={{ href: '/admin/content/topics', label: t('sections.topics.title') }}
      />
      <TopicForm
        defaultValues={{
          hasEn: false,
          translations: { vi: emptyTranslation(), en: emptyTranslation() },
        }}
      />
    </section>
  );
}
