'use client';

import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import { saveCookieConsentAction } from '@/actions/privacy';
import { Button } from '@/components/ui/button';
import { COOKIE_CONSENT_ANSWERED_ATTRIBUTE, type CookieChoice } from '@/lib/privacy/cookie-consent';

import { notifyConsentChanged, OPEN_PREFERENCES_EVENT, useCookieConsent } from './consent-store';
import { TagManager } from './tag-manager';

type Source = 'cookie_banner' | 'cookie_preferences';

const CookiePreferencesDialog = lazy(() => import('./cookie-preferences-dialog'));

/**
 * CookieConsentBanner + preferences (§8.2, PDPL 91/2025). No dark patterns: "Reject all" and
 * "Accept all" look the same and sit side by side; nothing optional is on by default; the
 * banner does not block the page; the choice can be changed any time from the footer.
 * GTM (GA4 + Meta Pixel) loads only after an optional category is granted.
 */
export function CookieConsentRoot({
  policyLink,
  gtmId,
}: {
  /** Link to the cookie (or privacy) policy in the current locale; streamed, may be empty. */
  policyLink: ReactNode;
  gtmId: string | null;
}) {
  const t = useTranslations('cookieConsent');
  const locale = useLocale() as 'vi' | 'en';
  const { ready, consent } = useCookieConsent();
  const [open, setOpen] = useState(false);
  // The preferences dialog loads on first opening and stays mounted afterwards.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, onOpen);
  }, []);

  function save(choice: CookieChoice, source: Source) {
    startTransition(async () => {
      const result = await saveCookieConsentAction({ ...choice, locale, source });
      if (!result.ok) {
        toast.error(t('saveFailed'));
        return;
      }
      notifyConsentChanged();
      setOpen(false);
      toast.success(t('saved'));
    });
  }

  // Once the browser's cookie is read, the component decides; until then (server render and
  // hydration) the banner is in the markup and the pre-paint script/CSS hides it for visitors
  // who already answered (see `cookieConsentPaintScript`).
  useEffect(() => {
    if (ready) document.documentElement.removeAttribute(COOKIE_CONSENT_ANSWERED_ATTRIBUTE);
  }, [ready]);

  const showBanner = !open && !(ready && consent);

  return (
    <>
      {/* Reads the pathname (signed-link pages defer GTM), so it streams after the shell. */}
      <Suspense fallback={null}>
        <TagManager gtmId={gtmId} consent={consent} />
      </Suspense>
      {showBanner && (
        <section
          aria-labelledby="cookie-banner-title"
          aria-describedby="cookie-banner-text"
          data-testid="cookie-banner"
          data-cookie-banner=""
          className="border-line-200 bg-ivory-50 shadow-overlay fixed inset-x-0 bottom-0 z-40 border-t"
        >
          <div className="container-content flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="cookie-banner-title" className="text-h3">
                {t('title')}
              </h2>
              <p id="cookie-banner-text" className="text-small text-taupe-600">
                {t('text')} {policyLink}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => save({ analytics: false, ads: false }, 'cookie_banner')}
              >
                {t('rejectAll')}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => save({ analytics: true, ads: true }, 'cookie_banner')}
              >
                {t('acceptAll')}
              </Button>
              <Button
                variant="ghost"
                className="col-span-2 sm:col-span-1"
                disabled={pending}
                onClick={() => setOpen(true)}
              >
                {t('customize')}
              </Button>
            </div>
          </div>
        </section>
      )}
      {used && (
        <Suspense fallback={null}>
          <CookiePreferencesDialog
            open={open}
            onOpenChange={setOpen}
            initial={consent ?? { analytics: false, ads: false }}
            pending={pending}
            policyLink={policyLink}
            onSave={(choice) => save(choice, 'cookie_preferences')}
          />
        </Suspense>
      )}
    </>
  );
}
