import { notFound } from 'next/navigation';

import { MenuBuilder } from '@/components/admin/content/menu-builder';
import { menuRows } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { getMenuForAdmin, MENU_KEYS, type MenuKey } from '@/server/modules/content';

import { PageHeader, requireContentAdmin } from '../../_shared';

export default async function EditMenuPage({
  params,
}: PageProps<'/admin/content/navigation/[key]'>) {
  const t = await requireContentAdmin();
  const { key } = await params;
  if (!(MENU_KEYS as readonly string[]).includes(key)) notFound();
  const menu = await getMenuForAdmin(getDb(), key);
  return (
    <section>
      <PageHeader
        title={t(`menuKeys.${key as MenuKey}`)}
        back={{ href: '/admin/content/navigation', label: t('sections.navigation.title') }}
      />
      <MenuBuilder menuKey={key} rows={menuRows(menu.items)} />
    </section>
  );
}
