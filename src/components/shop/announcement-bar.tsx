import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getLiveBanners } from '@/data/content';
import type { Locale } from '@/i18n/routing';

import { AnnouncementBarView } from './announcement-bar-view';
import { ANNOUNCEMENT_COOKIE } from './announcement-cookie';

/**
 * Site-wide announcement strip driven by the `announcement` banner placement (§8.2).
 * Dismissal is remembered per announcement in a cookie, so it never flashes back.
 * The fallback reserves the strip's height so the page does not shift down when it streams
 * in (CLS, §14.1); it is hidden before paint for visitors who dismissed one
 * (`announcementPaintScript`). Height: one line from `sm`, two lines on phones (a typical
 * 40–70 character announcement wraps there). With no live announcement the space collapses.
 */
export function AnnouncementBar() {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          data-announcement-placeholder=""
          className="bg-ink-950 min-h-13 sm:min-h-11"
        />
      }
    >
      <AnnouncementBarContent />
    </Suspense>
  );
}

async function AnnouncementBarContent() {
  await connection();
  const locale = (await getLocale()) as Locale;
  const [banner] = await getLiveBanners('announcement', locale);
  if (!banner) return null;
  const dismissed = (await cookies()).get(ANNOUNCEMENT_COOKIE)?.value;
  if (dismissed === banner.id) return null;
  const t = await getTranslations({ locale, namespace: 'banner' });
  return (
    <AnnouncementBarView
      id={banner.id}
      title={banner.title}
      ctaLabel={banner.ctaLabel}
      ctaUrl={banner.ctaUrl}
      labels={{ region: t('region'), dismiss: t('dismiss') }}
    />
  );
}
