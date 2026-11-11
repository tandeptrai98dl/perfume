import { PostForm } from '@/components/admin/content/post-form';
import { emptyTranslation } from '@/components/admin/content/values';

import { PageHeader, requireContentAdmin } from '../../_shared';
import { postFormOptions } from '../_options';

export default async function NewPostPage() {
  const t = await requireContentAdmin();
  const options = await postFormOptions();
  return (
    <section>
      <PageHeader
        title={t('sections.posts.new')}
        back={{ href: '/admin/content/posts', label: t('sections.posts.title') }}
      />
      <PostForm
        {...options}
        defaultValues={{
          status: 'draft',
          publishedAt: '',
          coverMediaId: '',
          topicIds: [],
          productIds: [],
          hasEn: false,
          translations: { vi: emptyTranslation(), en: emptyTranslation() },
        }}
      />
    </section>
  );
}
