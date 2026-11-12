'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveCookieConsentAction } from '@/actions/privacy';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { CookieChoice } from '@/lib/privacy/cookie-consent';

import { notifyConsentChanged, OPEN_PREFERENCES_EVENT, useCookieConsent } from './consent-store';
import { TagManager } from './tag-manager';

type Source = 'cookie_banner' | 'cookie_preferences';

/**
 * CookieConsentBanner + preferences (§8.2, PDPL 91/2025). No dark patterns: "Reject all" and
 * "Accept all" look the same and sit side by side; nothing optional is on by default; the
 * banner does not block the page; the choice can be changed any time from the footer.
 * GTM (GA4 + Meta Pixel) loads only after an optional category is granted.
 */
export function CookieConsentRoot({
  policyHref,
  gtmId,
}: {
  /** Cookie policy (or privacy policy) page in the current locale, when published. */
  policyHref: string | null;
  gtmId: string | null;
}) {
  const t = useTranslations('cookieConsent');
  const locale = useLocale() as 'vi' | 'en';
  const { ready, consent } = useCookieConsent();
  const [open, setOpen] = useState(false);
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

  const showBanner = ready && !consent && !open;

  return (
    <>
      <TagManager gtmId={gtmId} consent={consent} />
      {showBanner && (
        <section
          aria-labelledby="cookie-banner-title"
          aria-describedby="cookie-banner-text"
          data-testid="cookie-banner"
          className="border-line-200 bg-ivory-50 shadow-overlay fixed inset-x-0 bottom-0 z-40 border-t"
        >
          <div className="container-content flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="cookie-banner-title" className="text-h3">
                {t('title')}
              </h2>
              <p id="cookie-banner-text" className="text-small text-taupe-600">
                {t('text')}{' '}
                {policyHref && (
                  <a href={policyHref} className="text-gold-700 underline underline-offset-4">
                    {t('policyLink')}
                  </a>
                )}
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
      <CookiePreferencesDialog
        open={open}
        onOpenChange={setOpen}
        initial={consent ?? { analytics: false, ads: false }}
        pending={pending}
        policyHref={policyHref}
        onSave={(choice) => save(choice, 'cookie_preferences')}
      />
    </>
  );
}

function CookiePreferencesDialog({
  open,
  onOpenChange,
  initial,
  pending,
  policyHref,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CookieChoice;
  pending: boolean;
  policyHref: string | null;
  onSave: (choice: CookieChoice) => void;
}) {
  const t = useTranslations('cookieConsent');
  const id = useId();
  const [choice, setChoice] = useState<CookieChoice>(initial);
  // Each opening starts from the stored choice.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setChoice(initial);
  }

  const categories = [
    { key: 'necessary', checked: true, disabled: true },
    { key: 'analytics', checked: choice.analytics, disabled: false },
    { key: 'ads', checked: choice.ads, disabled: false },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white" data-testid="cookie-preferences">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('preferences.title')}</DialogTitle>
          <DialogDescription>
            {t('preferences.description')}{' '}
            {policyHref && (
              <a href={policyHref} className="text-gold-700 underline underline-offset-4">
                {t('policyLink')}
              </a>
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-line-200 flex flex-col divide-y">
          {categories.map((category) => (
            <li key={category.key} className="flex items-start justify-between gap-4 py-4">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${category.key}`} className="font-medium">
                  {t(`categories.${category.key}.title`)}
                </label>
                <p id={`${id}-${category.key}-desc`} className="text-small text-taupe-600">
                  {t(`categories.${category.key}.description`)}
                </p>
              </div>
              <div className="flex min-h-11 shrink-0 items-center gap-2">
                {category.disabled && (
                  <span className="text-small text-taupe-600">{t('alwaysOn')}</span>
                )}
                <Switch
                  id={`${id}-${category.key}`}
                  checked={category.checked}
                  disabled={category.disabled}
                  aria-describedby={`${id}-${category.key}-desc`}
                  onCheckedChange={(checked) =>
                    category.key !== 'necessary' &&
                    setChoice((current) => ({ ...current, [category.key]: checked }))
                  }
                />
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onSave({ analytics: false, ads: false })}
          >
            {t('rejectAll')}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onSave({ analytics: true, ads: true })}
          >
            {t('acceptAll')}
          </Button>
          <Button loading={pending} onClick={() => onSave(choice)}>
            {t('preferences.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
