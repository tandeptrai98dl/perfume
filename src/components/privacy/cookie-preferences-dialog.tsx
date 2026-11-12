'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

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

/**
 * Cookie preferences (§8.2): one switch per optional category. Loaded on first opening by
 * `CookieConsentRoot`, outside every page's first-load JavaScript (§14.1).
 */
export default function CookiePreferencesDialog({
  open,
  onOpenChange,
  initial,
  pending,
  policyLink,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CookieChoice;
  pending: boolean;
  policyLink: ReactNode;
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
            {t('preferences.description')} {policyLink}
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
