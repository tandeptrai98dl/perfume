import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/badge';
import { getDb } from '@/server/db/client';
import { listPostsForAdmin } from '@/server/modules/content';

import {
  cell,
  DataTable,
  formatDateTime,
  PageHeader,
  requireContentAdmin,
  TranslationBadge,
} from '../_shared';

export default async function AdminPostsPage({ searchParams }: PageProps<'/admin/content/posts'>) {
  const t = await requireContentAdmin();
  const { q, page } = await searchParams;
  const query = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  const pageNumber = Math.max(1, Number(page) || 1);
  const result = await listPostsForAdmin(getDb(), { q: query || undefined, page: pageNumber });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (n: number) =>
    `/admin/content/posts?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(n) })}`;

  return (
    <section>
      <PageHeader
        title={t('sections.posts.title')}
        description={t('sections.posts.description')}
        back={{ href: '/admin/content', label: t('title') }}
        action={{ href: '/admin/content/posts/new', label: t('new') }}
      />
      <form role="search" className="mb-6 flex max-w-md gap-2" action="/admin/content/posts">
        <label htmlFor="post-search" className="sr-only">
          {t('search')}
        </label>
        <input
          id="post-search"
          name="q"
          defaultValue={query}
          placeholder={t('search')}
          className="border-line-200 min-h-11 flex-1 border bg-white px-3"
        />
        <button type="submit" className="border-ink-950 text-button min-h-11 border px-4 uppercase">
          {t('searchSubmit')}
        </button>
      </form>
      <DataTable
        caption={t('sections.posts.title')}
        head={[t('columns.title'), t('columns.status'), t('columns.publishedAt'), 'VI', 'EN']}
        empty={result.rows.length === 0 ? t('empty.posts') : undefined}
      >
        {result.rows.map((post) => (
          <tr key={post.id}>
            <td className={cell}>
              <Link
                href={`/admin/content/posts/${post.id}` as Route}
                className="font-medium underline-offset-4 hover:underline"
              >
                {post.vi?.title ?? post.en?.title ?? post.id}
              </Link>
            </td>
            <td className={cell}>
              <Badge variant={post.status === 'active' ? 'dark' : 'outline'}>
                {t(`status.${post.status}`)}
              </Badge>
            </td>
            <td className={`${cell} text-small`}>{formatDateTime(post.publishedAt)}</td>
            <td className={cell}>
              <TranslationBadge status={post.vi} />
            </td>
            <td className={cell}>
              <TranslationBadge status={post.en} />
            </td>
          </tr>
        ))}
      </DataTable>
      {totalPages > 1 && (
        <nav aria-label={t('pagination')} className="mt-6 flex gap-4">
          {pageNumber > 1 && <Link href={href(pageNumber - 1) as Route}>{t('previous')}</Link>}
          <span className="text-taupe-600">
            {pageNumber} / {totalPages}
          </span>
          {pageNumber < totalPages && <Link href={href(pageNumber + 1) as Route}>{t('next')}</Link>}
        </nav>
      )}
    </section>
  );
}
