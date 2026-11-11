import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import type { CategoryRow } from '@/server/modules/catalog';

import { TranslationStatusBadge } from '../translation-status-badge';

/** The whole 2-level tree in one table; children are indented under their parent. */
export function CategoryTreeTable({ rows }: { rows: CategoryRow[] }) {
  const t = useTranslations('admin.categories');
  if (rows.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <div className="border-line-200 overflow-x-auto border">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('title')}</caption>
        <thead className="bg-sand-100">
          <tr>
            {(['name', 'slug', 'translations', 'products', 'order'] as const).map((column) => (
              <th key={column} scope="col" className="text-small px-3 py-2 font-medium">
                {t(`columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-line-200 border-t">
              <td className="text-small px-3 py-2">
                <Link
                  href={`/admin/catalog/categories/${row.id}` as Route}
                  className={row.parentId ? 'pl-6' : 'font-medium'}
                >
                  {row.parentId && <span aria-hidden>└ </span>}
                  {row.name}
                </Link>
              </td>
              <td className="text-small px-3 py-2 font-mono">{row.slug}</td>
              <td className="px-3 py-2">
                <span className="flex gap-1">
                  <TranslationStatusBadge locale="vi" status={row.viStatus} compact />
                  <TranslationStatusBadge locale="en" status={row.enStatus} compact />
                </span>
              </td>
              <td className="text-small px-3 py-2 tabular-nums">{row.productCount}</td>
              <td className="text-small px-3 py-2 tabular-nums">{row.sortOrder}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
