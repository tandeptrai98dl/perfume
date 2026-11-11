import { BannerEditor } from '@/components/admin/content/banner-editor';
import { emptyBannerTranslation } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { listMediaOptions } from '@/server/modules/content';

import { PageHeader, requireContentAdmin } from '../../_shared';

export default async function NewBannerPage() {
  const t = await requireContentAdmin();
  const media = await listMediaOptions(getDb());
  return (
    <section>
      <PageHeader
        title={t('sections.banners.new')}
        back={{ href: '/admin/content/banners', label: t('sections.banners.title') }}
      />
      <BannerEditor
        media={media}
        defaultValues={{
          placement: 'home_hero',
          position: 0,
          isActive: false,
          startsAt: '',
          endsAt: '',
          hasEn: false,
          translations: { vi: emptyBannerTranslation(), en: emptyBannerTranslation() },
        }}
      />
    </section>
  );
}
