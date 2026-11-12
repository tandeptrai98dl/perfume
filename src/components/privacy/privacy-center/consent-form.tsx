'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { updateAccountConsentsAction } from '@/actions/privacy';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { notifyConsentChanged } from '../consent-store';
import { usePrivacyError } from './errors';

type Values = { marketingEmail: boolean; marketingSms: boolean; analytics: boolean; ads: boolean };

const PURPOSES = ['marketingEmail', 'marketingSms', 'analytics', 'ads'] as const;

/**
 * Consent switches (privacy centre). Marketing e-mail / SMS belong to the account; analytics
 * and ads are this browser's cookie choice (also recorded against the account).
 */
export function ConsentForm({ initial }: { initial: Values }) {
  const t = useTranslations('privacyCenter.consents');
  const errorMessage = usePrivacyError();
  const locale = useLocale() as 'vi' | 'en';
  const id = useId();
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = PURPOSES.some((key) => values[key] !== saved[key]);

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateAccountConsentsAction({ ...values, locale });
          if (!result.ok) {
            setError(errorMessage(result.error));
            return;
          }
          setSaved(values);
          notifyConsentChanged();
          toast.success(t('saved'));
        });
      }}
    >
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <ul className="border-line-200 divide-line-200 flex flex-col divide-y border">
        {PURPOSES.map((key) => (
          <li key={key} className="flex items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="font-medium">
                {t(`${key}.title`)}
              </label>
              <p id={`${id}-${key}-desc`} className="text-small text-taupe-600">
                {t(`${key}.description`)}
              </p>
            </div>
            <div className="flex min-h-11 shrink-0 items-center">
              <Switch
                id={`${id}-${key}`}
                name={key}
                checked={values[key]}
                aria-describedby={`${id}-${key}-desc`}
                onCheckedChange={(checked) =>
                  setValues((current) => ({ ...current, [key]: checked }))
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-small text-taupe-600">{t('withdrawNote')}</p>
      <Button type="submit" loading={pending} disabled={!dirty} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
