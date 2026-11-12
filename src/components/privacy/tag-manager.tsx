'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  CONSENT_MODE_DEFAULTS,
  consentModeState,
  trackingCookieNames,
  urlCarriesSecret,
  type CookieConsent,
} from '@/lib/privacy/cookie-consent';

/**
 * Consent-gated Google Tag Manager (GA4 + Meta Pixel are configured inside the container).
 * - Nothing is loaded without `NEXT_PUBLIC_GTM_ID`, or before the visitor granted analytics or
 *   ads. Consent Mode v2 defaults (all denied) are pushed first, then the visitor's choice.
 * - The container must fire GA4 only with `analytics_storage` and the Meta Pixel only with
 *   `ad_storage` granted (Meta does not read Consent Mode itself); the `cookie_consent_update`
 *   dataLayer event carries the choice for custom triggers.
 * - Withdrawal: Consent Mode is updated to denied and GA / Meta cookies are deleted.
 * - Never started on a page whose URL carries a signed-link token (`urlCarriesSecret`): it
 *   starts on the next clean page instead, so tags never record the token.
 *
 * CSP (owned by the hardening stream): the script is inserted by this bundle (works with
 * `'strict-dynamic'`); hosts are listed in docs/ARCHITECTURE.md §12 "Analytics hosts".
 */

const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;
export const GTM_SCRIPT_HOST = 'https://www.googletagmanager.com';

type DataLayerWindow = Window & {
  dataLayer?: unknown[];
  __perfumeGtmLoaded?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function gtag(..._args: unknown[]) {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js reads the Arguments object, not an array.
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(arguments);
}

const ADS_COOKIE = /^(_fbp|_fbc|_gcl_.+)$/;

function deleteTrackingCookies(choice: { analytics: boolean; ads: boolean }) {
  const host = window.location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  const names = trackingCookieNames(document.cookie).filter((name) =>
    ADS_COOKIE.test(name) ? !choice.ads : !choice.analytics,
  );
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`;
    }
  }
}

export function TagManager({
  gtmId,
  consent,
}: {
  gtmId: string | null;
  consent: CookieConsent | null;
}) {
  const analytics = consent?.analytics ?? false;
  const ads = consent?.ads ?? false;
  // Re-checked on every navigation: a token page (e-mail link) defers loading to the next page.
  const pathname = usePathname();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!gtmId || !GTM_ID.test(gtmId)) return;
    const w = window as DataLayerWindow;
    const choice = { analytics, ads };
    const key = `${analytics}:${ads}`;
    if (!w.__perfumeGtmLoaded) {
      if (!analytics && !ads) return;
      if (urlCarriesSecret(window.location)) return;
      w.dataLayer = w.dataLayer ?? [];
      gtag('consent', 'default', CONSENT_MODE_DEFAULTS);
      gtag('consent', 'update', consentModeState(choice));
      w.dataLayer.push({ event: 'cookie_consent_update', cookieConsent: choice });
      w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const script = document.createElement('script');
      script.async = true;
      script.src = `${GTM_SCRIPT_HOST}/gtm.js?id=${encodeURIComponent(gtmId)}`;
      script.dataset.consentGated = 'gtm';
      document.head.appendChild(script);
      w.__perfumeGtmLoaded = true;
      applied.current = key;
      return;
    }
    // A navigation alone (pathname) changes nothing once the container runs.
    if (applied.current === key) return;
    applied.current = key;
    gtag('consent', 'update', consentModeState(choice));
    w.dataLayer?.push({ event: 'cookie_consent_update', cookieConsent: choice });
    deleteTrackingCookies(choice);
  }, [gtmId, analytics, ads, pathname]);

  return null;
}
