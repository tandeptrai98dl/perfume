import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getInfoPage } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { clientEnv } from '@/lib/env';

import { CookieConsentRoot } from './cookie-consent-root';

/**
 * Mounts the cookie banner, the preferences dialog and the consent-gated tag loader on every
 * storefront page (locale layout). The banner is part of the static shell so it paints with
 * the first frame (it is the largest text on a first visit, hence the LCP element, §14.1);
 * returning visitors are hidden before paint by `cookieConsentPaintScript()`. Only the policy
 * link reads content, so it streams in at request time.
 */
export function CookieConsent({ locale }: { locale: Locale }) {
  return (
    <CookieConsentRoot
      policyLink={
        <Suspense fallback={<CookiePolicyLinkPlaceholder locale={locale} />}>
          <CookiePolicyLink locale={locale} />
        </Suspense>
      }
      gtmId={clientEnv.NEXT_PUBLIC_GTM_ID ?? null}
    />
  );
}

/**
 * Same text as the link, so the banner keeps its size when the link streams in (a growing
 * fixed banner counts as a layout shift, §14.1).
 */
async function CookiePolicyLinkPlaceholder({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'cookieConsent' });
  return <span className="text-gold-700 underline underline-offset-4">{t('policyLink')}</span>;
}

/** The cookie policy, or the privacy policy while the cookie policy has no translation. */
async function CookiePolicyLink({ locale }: { locale: Locale }) {
  await connection();
  let policyHref: string | null = null;
  try {
    const page = (await getInfoPage('cookies', locale)) ?? (await getInfoPage('privacy', locale));
    policyHref = page?.path ?? null;
  } catch {
    // The banner must work even when content cannot be read; it just has no link then.
  }
  if (!policyHref) return null;
  const t = await getTranslations({ locale, namespace: 'cookieConsent' });
  return (
    <a href={policyHref} className="text-gold-700 underline underline-offset-4">
      {t('policyLink')}
    </a>
  );
}
