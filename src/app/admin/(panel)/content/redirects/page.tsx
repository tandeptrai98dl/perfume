import Link from 'next/link';
import type { Route } from 'next';

import { deleteRedirectAction } from '@/actions/admin/content';
import { DeleteButton } from '@/components/admin/content/form-kit';
import { RedirectForm } from '@/components/admin/content/redirect-form';
import { getDb } from '@/server/db/client';
import { listRedirectsForAdmin } from '@/server/modules/content';

import { cell, DataTable, formatDateTime, PageHeader, requireContentAdmin } from '../_shared';

export default async function AdminRedirectsPage({
  searchParams,
}: PageProps<'/admin/content/redirects'>) {
  const t = await requireContentAdmin();
  const { q, page } = await searchParams;
  const query = typeof q === 'string' ? q.trim().slice(0, 200) : '';
  const pageNumber = Math.max(1, Number(page) || 1);
  const result = await listRedirectsForAdmin(getDb(), { q: query || undefined, page: pageNumber });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (n: number) =>
    `/admin/content/redirects?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(n) })}`;

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title={t('sections.redirects.title')}
        description={t('sections.redirects.description')}
        back={{ href: '/admin/content', label: t('title') }}
      />
      <section aria-labelledby="new-redirect" className="border-line-200 border p-6">
        <h2 id="new-redirect" className="text-h3 mb-4">
          {t('redirects.create')}
        </h2>
        <RedirectForm />
      </section>
      <form role="search" className="flex max-w-md gap-2" action="/admin/content/redirects">
        <label htmlFor="redirect-search" className="sr-only">
          {t('search')}
        </label>
        <input
          id="redirect-search"
          name="q"
          defaultValue={query}
          placeholder={t('search')}
          className="border-line-200 min-h-11 flex-1 border bg-white px-3"
        />
        <button type="submit" className="border-ink-950 text-button min-h-11 border px-4 uppercase">
          {t('searchSubmit')}
        </button>
      </form>
      <p className="text-small text-taupe-600">{t('redirects.total', { count: result.total })}</p>
      <DataTable
        caption={t('sections.redirects.title')}
        head={[
          t('columns.from'),
          t('columns.to'),
          t('columns.code'),
          t('columns.hits'),
          t('columns.lastHit'),
          t('actions'),
        ]}
        empty={result.rows.length === 0 ? t('empty.redirects') : undefined}
      >
        {result.rows.map((row) => (
          <tr key={row.id}>
            <td className={`${cell} text-small font-mono break-all`}>{row.fromPath}</td>
            <td className={`${cell} text-small font-mono break-all`}>{row.toPath}</td>
            <td className={`${cell} text-small tabular-nums`}>{row.statusCode}</td>
            <td className={`${cell} text-small tabular-nums`}>{row.hitCount}</td>
            <td className={`${cell} text-small`}>{formatDateTime(row.lastHitAt)}</td>
            <td className={cell}>
              <DeleteButton action={deleteRedirectAction.bind(null, row.id)} />
            </td>
          </tr>
        ))}
      </DataTable>
      {totalPages > 1 && (
        <nav aria-label={t('pagination')} className="flex gap-4">
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
