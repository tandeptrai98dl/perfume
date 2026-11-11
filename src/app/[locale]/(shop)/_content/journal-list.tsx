import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Route } from 'next';

import { PostCard } from '@/components/content/post-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { getTopics } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { localizedPath } from '@/lib/seo/paths';
import { cn } from '@/lib/utils';
import type { PostSummary } from '@/server/modules/content';

export const JOURNAL_PAGE_SIZE = 12;

/** Post grid + pagination shared by the journal index and topic pages. */
export async function JournalList({
  locale,
  posts,
  page,
  basePath,
}: {
  locale: Locale;
  posts: PostSummary[];
  page: number;
  basePath: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: 'journal' }),
    getFormatter({ locale }),
  ]);
  const totalPages = Math.max(1, Math.ceil(posts.length / JOURNAL_PAGE_SIZE));
  const visible = posts.slice((page - 1) * JOURNAL_PAGE_SIZE, page * JOURNAL_PAGE_SIZE);

  if (visible.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <>
      <div className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            dateLabel={format.dateTime(new Date(post.publishedAt), { dateStyle: 'long' })}
          />
        ))}
      </div>
      <Pagination
        className="mt-16"
        page={page}
        totalPages={totalPages}
        hrefFor={(n) => (n === 1 ? basePath : `${basePath}?page=${n}`)}
      />
    </>
  );
}

/** Topic links; `current` is the active topic slug (none on the journal index). */
export async function TopicNav({ locale, current }: { locale: Locale; current?: string }) {
  const [topics, t] = await Promise.all([
    getTopics(locale),
    getTranslations({ locale, namespace: 'journal' }),
  ]);
  if (topics.length === 0) return null;
  const item = 'eyebrow inline-flex min-h-11 items-center border-b px-1';
  return (
    <nav aria-label={t('topics')} className="mb-12">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        <li>
          <Link
            href={localizedPath(locale, '/journal') as Route}
            aria-current={current ? undefined : 'page'}
            className={cn(item, current ? 'border-transparent text-taupe-600' : 'border-ink-950')}
          >
            {t('allTopics')}
          </Link>
        </li>
        {topics.map((topic) => (
          <li key={topic.id}>
            <Link
              href={topic.path as Route}
              aria-current={current === topic.slug ? 'page' : undefined}
              className={cn(
                item,
                current === topic.slug
                  ? 'border-ink-950'
                  : 'hover:text-ink-950 border-transparent text-taupe-600',
              )}
            >
              {topic.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
