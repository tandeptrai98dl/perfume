import { getFormatter, getTranslations } from 'next-intl/server';

import { PostCard } from '@/components/content/post-card';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { PostSummary } from '@/server/modules/content';

/** JournalTeaser (§8.3): the latest published posts of the current locale. */
export async function JournalTeaser({ locale, posts }: { locale: Locale; posts: PostSummary[] }) {
  if (posts.length === 0) return null;
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: 'home' }),
    getFormatter({ locale }),
  ]);
  return (
    <section
      aria-labelledby="home-journal"
      className="container-content flex flex-col gap-10 py-(--spacing-section)"
      data-testid="journal-teaser"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-gold-700">{t('journalEyebrow')}</p>
          <h2 id="home-journal" className="text-display-lg">
            {t('journalTitle')}
          </h2>
        </div>
        <Link
          href="/journal"
          className="text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t('viewJournal')}
        </Link>
      </div>
      <div className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            headingLevel="h3"
            dateLabel={format.dateTime(new Date(post.publishedAt), { dateStyle: 'long' })}
          />
        ))}
      </div>
    </section>
  );
}
