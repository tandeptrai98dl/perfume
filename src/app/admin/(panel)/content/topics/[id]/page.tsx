import { notFound } from 'next/navigation';

import { TopicForm } from '@/components/admin/content/topic-form';
import { translationValues } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { getTopicForAdmin } from '@/server/modules/content';

import { idParam, PageHeader, requireContentAdmin } from '../../_shared';

export default async function EditTopicPage({ params }: PageProps<'/admin/content/topics/[id]'>) {
  const t = await requireContentAdmin();
  const id = await idParam(params);
  const topic = await getTopicForAdmin(getDb(), id);
  if (!topic) notFound();
  const value = (locale: 'vi' | 'en') => {
    const stored = topic.translations[locale];
    return translationValues(stored && { ...stored, excerpt: stored.description });
  };
  return (
    <section>
      <PageHeader
        title={topic.translations.vi?.name ?? t('sections.topics.title')}
        back={{ href: '/admin/content/topics', label: t('sections.topics.title') }}
      />
      <TopicForm
        id={topic.id}
        defaultValues={{
          hasEn: Boolean(topic.translations.en),
          translations: { vi: value('vi'), en: value('en') },
        }}
      />
    </section>
  );
}
