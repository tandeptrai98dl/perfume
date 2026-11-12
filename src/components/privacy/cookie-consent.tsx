import { connection } from 'next/server';

import { getInfoPage } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { clientEnv } from '@/lib/env';

import { CookieConsentRoot } from './cookie-consent-root';

/**
 * Mounts the cookie banner, the preferences dialog and the consent-gated tag loader on every
 * storefront page (rendered inside <Suspense> by the locale layout). Links to the cookie
 * policy, or to the privacy policy while the cookie policy has no published translation.
 */
export async function CookieConsent({ locale }: { locale: Locale }) {
  await connection();
  let policyHref: string | null = null;
  try {
    const page = (await getInfoPage('cookies', locale)) ?? (await getInfoPage('privacy', locale));
    policyHref = page?.path ?? null;
  } catch {
    // The banner must work even when content cannot be read; it just has no link then.
  }
  return <CookieConsentRoot policyHref={policyHref} gtmId={clientEnv.NEXT_PUBLIC_GTM_ID ?? null} />;
}
