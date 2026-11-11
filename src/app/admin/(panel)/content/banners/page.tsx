import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/badge';
import { getDb } from '@/server/db/client';
import { isBannerLive, listBannersForAdmin } from '@/server/modules/content';

import {
  cell,
  DataTable,
  formatDateTime,
  PageHeader,
  requireContentAdmin,
  TranslationBadge,
} from '../_shared';

export default async function AdminBannersPage() {
  const t = await requireContentAdmin();
  const banners = await listBannersForAdmin(getDb());
  const now = new Date();
  return (
    <section>
      <PageHeader
        title={t('sections.banners.title')}
        description={t('sections.banners.description')}
        back={{ href: '/admin/content', label: t('title') }}
        action={{ href: '/admin/content/banners/new', label: t('new') }}
      />
      <DataTable
        caption={t('sections.banners.title')}
        head={[
          t('columns.title'),
          t('columns.placement'),
          t('columns.position'),
          t('columns.schedule'),
          t('columns.status'),
          'VI',
          'EN',
        ]}
        empty={banners.length === 0 ? t('empty.banners') : undefined}
      >
        {banners.map((banner) => {
          const live = banner.isActive && isBannerLive(banner, now);
          return (
            <tr key={banner.id}>
              <td className={cell}>
                <Link
                  href={`/admin/content/banners/${banner.id}` as Route}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {banner.vi?.title ?? banner.en?.title ?? banner.id}
                </Link>
              </td>
              <td className={`${cell} text-small`}>{t(`placement.${banner.placement}`)}</td>
              <td className={`${cell} text-small tabular-nums`}>{banner.position}</td>
              <td className={`${cell} text-small`}>
                {formatDateTime(banner.startsAt)} → {formatDateTime(banner.endsAt)}
              </td>
              <td className={cell}>
                <Badge variant={live ? 'success' : 'outline'}>
                  {t(live ? 'bannerState.live' : 'bannerState.off')}
                </Badge>
              </td>
              <td className={cell}>
                <TranslationBadge status={banner.vi} />
              </td>
              <td className={cell}>
                <TranslationBadge status={banner.en} />
              </td>
            </tr>
          );
        })}
      </DataTable>
    </section>
  );
}
