'use client';

import { useTranslations } from 'next-intl';

import { openCookiePreferences } from './consent-store';

/** Footer link that re-opens the cookie preferences (withdrawal as easy as consent). */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useTranslations('cookieConsent');
  return (
    <button type="button" className={className} onClick={() => openCookiePreferences()}>
      {t('settings')}
    </button>
  );
}
