import { notFound } from 'next/navigation';

import { BannerEditor } from '@/components/admin/content/banner-editor';
import { emptyBannerTranslation, toAdminInput } from '@/components/admin/content/values';
import { getDb } from '@/server/db/client';
import { getBannerForAdmin, listMediaOptions } from '@/server/modules/content';

import { idParam, PageHeader, requireContentAdmin } from '../../_shared';

export default async function EditBannerPage({ params }: PageProps<'/admin/content/banners/[id]'>) {
  const t = await requireContentAdmin();
  const id = await idParam(params);
  const [banner, media] = await Promise.all([
    getBannerForAdmin(getDb(), id),
    listMediaOptions(getDb()),
  ]);
  if (!banner) notFound();
  const value = (locale: 'vi' | 'en') => {
    const stored = banner.translations[locale];
    if (!stored) return emptyBannerTranslation();
    return {
      title: stored.title,
      subtitle: stored.subtitle ?? '',
      ctaLabel: stored.ctaLabel ?? '',
      ctaUrl: stored.ctaUrl ?? '',
      desktopMediaId: stored.desktopMediaId ?? '',
      mobileMediaId: stored.mobileMediaId ?? '',
      isPublished: stored.isPublished,
    };
  };
  return (
    <section>
      <PageHeader
        title={banner.translations.vi?.title ?? t('sections.banners.title')}
        back={{ href: '/admin/content/banners', label: t('sections.banners.title') }}
      />
      <BannerEditor
        id={banner.id}
        media={media}
        defaultValues={{
          placement: banner.placement,
          position: banner.position,
          isActive: banner.isActive,
          startsAt: toAdminInput(banner.startsAt),
          endsAt: toAdminInput(banner.endsAt),
          hasEn: Boolean(banner.translations.en),
          translations: { vi: value('vi'), en: value('en') },
        }}
      />
    </section>
  );
}
