import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { ContentArticleSkeleton } from '@/components/content/content-article';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { getPostSummaries, visibleNow } from '@/data/content';
import { contentMetadata } from '@/lib/seo/content-metadata';
import { localizedPath } from '@/lib/seo/paths';

import { JournalList, TopicNav } from '../_content/journal-list';
import { pageParam, resolveLocale, siteOrigin } from '../_content/shared';

type Props = PageProps<'/[locale]/journal'>;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const page = pageParam((await searchParams).page);
  const t = await getTranslations({ locale, namespace: 'journal' });
  const suffix = page > 1 ? `?page=${page}` : '';
  return contentMetadata({
    origin: siteOrigin(),
    locale,
    title: page > 1 ? t('pagedTitle', { page }) : t('title'),
    description: t('description'),
    path: `${localizedPath(locale, '/journal')}${suffix}`,
    alternates: {
      vi: `${localizedPath('vi', '/journal')}${suffix}`,
      en: `${localizedPath('en', '/journal')}${suffix}`,
    },
  });
}

/** Journal index (§5.1, §13.2): newest posts first, `?page=` pagination. */
export default function JournalPage(props: Props) {
  return (
    <Suspense fallback={<ContentArticleSkeleton />}>
      <JournalBody {...props} />
    </Suspense>
  );
}

async function JournalBody({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const page = pageParam((await searchParams).page);
  await connection();
  const [posts, t, tNav] = await Promise.all([
    getPostSummaries(locale),
    getTranslations({ locale, namespace: 'journal' }),
    getTranslations({ locale, namespace: 'navigation' }),
  ]);
  const basePath = localizedPath(locale, '/journal');

  return (
    <section className="container-content py-10 lg:py-16" aria-labelledby="journal-title">
      <Breadcrumb
        className="mb-8"
        baseUrl={siteOrigin()}
        items={[{ name: tNav('home'), href: localizedPath(locale, '/') }, { name: t('title') }]}
      />
      <header className="mb-10 flex max-w-3xl flex-col gap-4">
        <h1 id="journal-title" className="text-display-lg">
          {t('title')}
        </h1>
        <p className="text-body-lg text-taupe-600">{t('description')}</p>
      </header>
      <TopicNav locale={locale} />
      <JournalList locale={locale} posts={visibleNow(posts)} page={page} basePath={basePath} />
    </section>
  );
}
