import { notFound } from 'next/navigation';

import { PostForm } from '@/components/admin/content/post-form';
import { toAdminInput, translationValues } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { getPostForAdmin } from '@/server/modules/content';

import { idParam, PageHeader, requireContentAdmin } from '../../_shared';
import { postFormOptions } from '../_options';

export default async function EditPostPage({ params }: PageProps<'/admin/content/posts/[id]'>) {
  const t = await requireContentAdmin();
  const id = await idParam(params);
  const [post, options] = await Promise.all([getPostForAdmin(getDb(), id), postFormOptions()]);
  if (!post) notFound();
  return (
    <section>
      <PageHeader
        title={post.translations.vi?.title ?? t('sections.posts.title')}
        back={{ href: '/admin/content/posts', label: t('sections.posts.title') }}
      />
      <PostForm
        id={post.id}
        {...options}
        defaultValues={{
          status: post.status,
          publishedAt: toAdminInput(post.publishedAt),
          coverMediaId: post.coverMediaId ?? '',
          topicIds: post.topicIds,
          productIds: post.productIds,
          hasEn: Boolean(post.translations.en),
          translations: {
            vi: translationValues(post.translations.vi),
            en: translationValues(post.translations.en),
          },
        }}
      />
    </section>
  );
}
