import Link from 'next/link';
import type { Route } from 'next';

import { getDb } from '@/server/db/client';
import { getMenuForAdmin, MENU_KEYS, type MenuKey } from '@/server/modules/content';

import { cell, DataTable, PageHeader, requireContentAdmin } from '../_shared';

export default async function AdminNavigationPage() {
  const t = await requireContentAdmin();
  const menus = await Promise.all(MENU_KEYS.map((key) => getMenuForAdmin(getDb(), key)));
  return (
    <section>
      <PageHeader
        title={t('sections.navigation.title')}
        description={t('sections.navigation.description')}
        back={{ href: '/admin/content', label: t('title') }}
      />
      <DataTable caption={t('sections.navigation.title')} head={[t('columns.menu'), 'VI', 'EN']}>
        {menus.map((menu) => (
          <tr key={menu.key}>
            <td className={cell}>
              <Link
                href={`/admin/content/navigation/${menu.key}` as Route}
                className="font-medium underline-offset-4 hover:underline"
              >
                {t(`menuKeys.${menu.key as MenuKey}`)}
              </Link>
            </td>
            <td className={`${cell} text-small tabular-nums`}>
              {t('menu.count', { count: menu.items.vi.length })}
            </td>
            <td className={`${cell} text-small tabular-nums`}>
              {t('menu.count', { count: menu.items.en.length })}
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}
