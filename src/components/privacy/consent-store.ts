'use client';

import { useMemo, useSyncExternalStore } from 'react';

import {
  isCurrentConsent,
  readCookieConsent,
  type CookieConsent,
} from '@/lib/privacy/cookie-consent';

/**
 * Browser-side view of the cookie choice (`cookie_consent` cookie). The Server Action sets the
 * cookie; callers then dispatch `CONSENT_CHANGED_EVENT` so every subscriber re-reads it.
 * Nothing renders on the server: the choice is only known in the browser.
 */

export const CONSENT_CHANGED_EVENT = 'perfume:cookie-consent-changed';
export const OPEN_PREFERENCES_EVENT = 'perfume:open-cookie-preferences';

function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.removeEventListener('focus', onChange);
  };
}

const getSnapshot = () => document.cookie;
const getServerSnapshot = () => null;

export type ConsentSnapshot =
  { ready: false; consent: null } | { ready: true; consent: CookieConsent | null };

/** `consent` is null until answered for the current notice version. */
export function useCookieConsent(): ConsentSnapshot {
  const cookie = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    if (cookie === null) return { ready: false, consent: null };
    const consent = readCookieConsent(cookie);
    return { ready: true, consent: isCurrentConsent(consent) ? consent : null };
  }, [cookie]);
}

export function notifyConsentChanged() {
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
}
