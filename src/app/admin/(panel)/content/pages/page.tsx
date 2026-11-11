import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/badge';
import { getDb } from '@/server/db/client';
import { listPagesForAdmin } from '@/server/modules/content';

import {
  cell,
  DataTable,
  formatDateTime,
  PageHeader,
  requireContentAdmin,
  TranslationBadge,
} from '../_shared';

export default async function AdminPagesPage() {
  const t = await requireContentAdmin();
  const pages = await listPagesForAdmin(getDb());
  return (
    <section>
      <PageHeader
        title={t('sections.pages.title')}
        description={t('sections.pages.description')}
        back={{ href: '/admin/content', label: t('title') }}
        action={{ href: '/admin/content/pages/new', label: t('new') }}
      />
      <DataTable
        caption={t('sections.pages.title')}
        head={[
          t('columns.title'),
          t('columns.key'),
          t('columns.status'),
          'VI',
          'EN',
          t('columns.updatedAt'),
        ]}
        empty={pages.length === 0 ? t('empty.pages') : undefined}
      >
        {pages.map((page) => (
          <tr key={page.id}>
            <td className={cell}>
              <Link
                href={`/admin/content/pages/${page.id}` as Route}
                className="font-medium underline-offset-4 hover:underline"
              >
                {page.vi?.title ?? page.key}
              </Link>
            </td>
            <td className={`${cell} text-small font-mono`}>{page.key}</td>
            <td className={cell}>
              <Badge variant={page.status === 'active' ? 'dark' : 'outline'}>
                {t(`status.${page.status}`)}
              </Badge>
            </td>
            <td className={cell}>
              <TranslationBadge status={page.vi} />
            </td>
            <td className={cell}>
              <TranslationBadge status={page.en} />
            </td>
            <td className={`${cell} text-small`}>{formatDateTime(page.updatedAt)}</td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}
