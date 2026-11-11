import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { ContentArticleSkeleton } from '@/components/content/content-article';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { getPostSummaries, getTopic, visibleNow } from '@/data/content';
import { contentMetadata } from '@/lib/seo/content-metadata';
import { localizedPath } from '@/lib/seo/paths';

import { JournalList, TopicNav } from '../../../_content/journal-list';
import { pageParam, resolveLocale, siteOrigin } from '../../../_content/shared';

type Props = PageProps<'/[locale]/journal/topics/[slug]'>;

async function loadTopic(params: Props['params']) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  await connection();
  return { locale, topic: await getTopic(slug, locale) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, topic } = await loadTopic(params);
  if (!topic) return {};
  const page = pageParam((await searchParams).page);
  const t = await getTranslations({ locale, namespace: 'journal' });
  const suffix = page > 1 ? `?page=${page}` : '';
  return contentMetadata({
    origin: siteOrigin(),
    locale,
    title: t('topicTitle', { name: topic.name }),
    description: topic.description ?? t('topicDescription', { name: topic.name }),
    path: `${topic.path}${suffix}`,
    alternates: Object.fromEntries(
      Object.entries(topic.alternates).map(([l, path]) => [l, `${path}${suffix}`]),
    ),
  });
}

/** Posts of one journal topic (§5.1 `journal/topics/[slug]`). */
export default function TopicPage(props: Props) {
  return (
    <Suspense fallback={<ContentArticleSkeleton />}>
      <TopicBody {...props} />
    </Suspense>
  );
}

async function TopicBody({ params, searchParams }: Props) {
  const { locale, topic } = await loadTopic(params);
  if (!topic) notFound();
  const page = pageParam((await searchParams).page);
  const [posts, t, tNav] = await Promise.all([
    getPostSummaries(locale, topic.id),
    getTranslations({ locale, namespace: 'journal' }),
    getTranslations({ locale, namespace: 'navigation' }),
  ]);

  return (
    <section className="container-content py-10 lg:py-16" aria-labelledby="topic-title">
      <Breadcrumb
        className="mb-8"
        baseUrl={siteOrigin()}
        items={[
          { name: tNav('home'), href: localizedPath(locale, '/') },
          { name: t('title'), href: localizedPath(locale, '/journal') },
          { name: topic.name },
        ]}
      />
      <header className="mb-10 flex max-w-3xl flex-col gap-4">
        <p className="eyebrow text-gold-700">{t('topic')}</p>
        <h1 id="topic-title" className="text-display-lg">
          {topic.name}
        </h1>
        {topic.description && <p className="text-body-lg text-taupe-600">{topic.description}</p>}
      </header>
      <TopicNav locale={locale} current={topic.slug} />
      <JournalList locale={locale} posts={visibleNow(posts)} page={page} basePath={topic.path} />
    </section>
  );
}
