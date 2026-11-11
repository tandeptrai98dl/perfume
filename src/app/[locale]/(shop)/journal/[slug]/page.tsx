import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import type { Route } from 'next';
import { Suspense } from 'react';

import { ContentArticle, ContentArticleSkeleton } from '@/components/content/content-article';
import { Image } from '@/components/ui/image';
import { getPost, visibleNow } from '@/data/content';
import { richTextToPlainText } from '@/lib/rich-text';
import { RichText } from '@/lib/rich-text/react';
import { articleJsonLd, serializeJsonLd } from '@/lib/seo/content-json-ld';
import { contentMetadata } from '@/lib/seo/content-metadata';
import { absoluteUrl, localizedPath } from '@/lib/seo/paths';
import type { PostView } from '@/server/modules/content';

import { resolveLocale, siteOrigin } from '../../_content/shared';

type Props = PageProps<'/[locale]/journal/[slug]'>;

async function loadPost(params: Props['params']) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  await connection();
  const post = await getPost(slug, locale);
  // Scheduled posts stay hidden until `publishedAt` (cached data never bakes in "now").
  return { locale, post: post && visibleNow([post]).length ? post : null };
}

function toAbsolute(origin: string, url: string) {
  return /^https?:\/\//.test(url) ? url : absoluteUrl(origin, url);
}

function description(post: PostView) {
  return post.seoDescription ?? post.excerpt ?? richTextToPlainText(post.content);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, post } = await loadPost(params);
  if (!post) return {};
  return contentMetadata({
    origin: siteOrigin(),
    locale,
    title: post.seoTitle ?? post.title,
    description: description(post),
    path: post.path,
    alternates: post.alternates,
    type: 'article',
    publishedTime: new Date(post.publishedAt),
    modifiedTime: new Date(post.updatedAt),
    image: post.cover?.url,
  });
}

/** Journal article with Article JSON-LD (§13.1). */
export default function JournalPostPage({ params }: Props) {
  return (
    <Suspense fallback={<ContentArticleSkeleton />}>
      <PostBody params={params} />
    </Suspense>
  );
}

async function PostBody({ params }: { params: Props['params'] }) {
  const { locale, post } = await loadPost(params);
  if (!post) notFound();

  const [t, format] = await Promise.all([getTranslations({ locale }), getFormatter({ locale })]);
  const origin = siteOrigin();
  const publishedAt = new Date(post.publishedAt);
  const jsonLd = articleJsonLd({
    url: absoluteUrl(origin, post.path),
    headline: post.title,
    description: description(post),
    datePublished: publishedAt,
    dateModified: new Date(post.updatedAt),
    inLanguage: locale,
    siteName: t('metadata.siteName'),
    siteUrl: absoluteUrl(origin, localizedPath(locale, '/')),
    authorName: post.authorName,
    image: post.cover ? toAbsolute(origin, post.cover.url) : null,
  });

  return (
    <ContentArticle
      title={post.title}
      lead={post.excerpt}
      breadcrumbs={[
        { name: t('navigation.home'), href: localizedPath(locale, '/') },
        { name: t('journal.title'), href: localizedPath(locale, '/journal') },
        { name: post.title },
      ]}
      baseUrl={origin}
      meta={
        <p>
          <time dateTime={publishedAt.toISOString()}>
            {t('journal.publishedOn', {
              date: format.dateTime(publishedAt, { dateStyle: 'long' }),
            })}
          </time>
          {post.authorName && <> · {t('journal.byAuthor', { name: post.authorName })}</>}
        </p>
      }
    >
      {post.cover && (
        <Image
          src={post.cover.url}
          alt=""
          ratio="16/9"
          priority
          sizes="(min-width: 1200px) 1200px, 100vw"
          frameClassName="mb-10"
        />
      )}
      <RichText value={post.content} siteOrigin={origin} />
      {post.topics.length > 0 && (
        <nav
          aria-label={t('journal.topics')}
          className="border-line-200 mt-12 max-w-prose border-t pt-6"
        >
          <ul className="flex flex-wrap gap-3">
            {post.topics.map((topic) => (
              <li key={topic.slug}>
                <Link
                  href={topic.path as Route}
                  className="eyebrow border-line-200 hover:border-ink-950 inline-flex min-h-11 items-center border px-3"
                >
                  {topic.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
    </ContentArticle>
  );
}
