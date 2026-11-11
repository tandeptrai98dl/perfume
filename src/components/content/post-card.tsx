import Link from 'next/link';
import type { Route } from 'next';

import { Image } from '@/components/ui/image';
import type { PostSummary } from '@/server/modules/content';

/** Journal teaser: cover (if any), date, title, excerpt. The whole title is the link. */
export function PostCard({
  post,
  dateLabel,
  headingLevel = 'h2',
}: {
  post: PostSummary;
  dateLabel: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <article className="group flex flex-col gap-4">
      {post.cover && (
        <Image
          src={post.cover.url}
          alt=""
          ratio="3/2"
          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          className="ease-luxe transition-transform duration-(--duration-reveal) group-hover:scale-[1.02]"
        />
      )}
      <p className="eyebrow text-taupe-600">
        <time dateTime={new Date(post.publishedAt).toISOString()}>{dateLabel}</time>
      </p>
      <Heading className="text-h3">
        <Link
          href={post.path as Route}
          className="hover:text-gold-700 underline-offset-4 group-hover:underline"
        >
          {post.title}
        </Link>
      </Heading>
      {post.excerpt && <p className="text-taupe-600">{post.excerpt}</p>}
    </article>
  );
}
