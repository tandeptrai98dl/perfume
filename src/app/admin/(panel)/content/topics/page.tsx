import Link from 'next/link';
import type { Route } from 'next';

import { getDb } from '@/server/db/client';
import { listTopicsForAdmin } from '@/server/modules/content';

import { cell, DataTable, PageHeader, requireContentAdmin, TranslationBadge } from '../_shared';

export default async function AdminTopicsPage() {
  const t = await requireContentAdmin();
  const topics = await listTopicsForAdmin(getDb());
  return (
    <section>
      <PageHeader
        title={t('sections.topics.title')}
        description={t('sections.topics.description')}
        back={{ href: '/admin/content', label: t('title') }}
        action={{ href: '/admin/content/topics/new', label: t('new') }}
      />
      <DataTable
        caption={t('sections.topics.title')}
        head={[t('fields.name'), t('fields.slug'), 'VI', 'EN']}
        empty={topics.length === 0 ? t('empty.topics') : undefined}
      >
        {topics.map((topic) => (
          <tr key={topic.id}>
            <td className={cell}>
              <Link
                href={`/admin/content/topics/${topic.id}` as Route}
                className="font-medium underline-offset-4 hover:underline"
              >
                {topic.vi?.title ?? topic.en?.title ?? topic.id}
              </Link>
            </td>
            <td className={`${cell} text-small font-mono`}>{topic.vi?.slug ?? '—'}</td>
            <td className={cell}>
              <TranslationBadge status={topic.vi} />
            </td>
            <td className={cell}>
              <TranslationBadge status={topic.en} />
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}
