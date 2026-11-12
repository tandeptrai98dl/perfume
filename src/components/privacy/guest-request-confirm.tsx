'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { confirmGuestPrivacyAction } from '@/actions/privacy';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';

import { usePrivacyError } from './privacy-center/errors';

const TYPE_KEY = {
  export: 'export',
  delete: 'delete',
  correct: 'correct',
  withdraw_consent: 'withdrawConsent',
} as const;

/** Summary of the signed request and the explicit "Confirm" step. */
export function GuestRequestConfirm({
  token,
  email,
  type,
  details,
}: {
  token: string;
  email: string;
  type: keyof typeof TYPE_KEY;
  details: string | null;
}) {
  const t = useTranslations('privacyRequest.confirm');
  const tTypes = useTranslations('privacyCenter.requests.types');
  const format = useFormatter();
  const errorMessage = usePrivacyError();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ dueAt: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result) {
    return (
      <FormNotice tone="success">
        {result.status === 'completed'
          ? t('doneImmediate')
          : type === 'export'
            ? t('doneExport')
            : t('done', { date: format.dateTime(new Date(result.dueAt), { dateStyle: 'long' }) })}
      </FormNotice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-taupe-600">{t('email')}</dt>
        <dd className="break-all">{email}</dd>
        <dt className="text-taupe-600">{t('type')}</dt>
        <dd>{tTypes(TYPE_KEY[type])}</dd>
        {details && (
          <>
            <dt className="text-taupe-600">{t('details')}</dt>
            <dd className="whitespace-pre-line">{details}</dd>
          </>
        )}
      </dl>
      <Button
        className="self-start"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const response = await confirmGuestPrivacyAction({ token });
            if (!response.ok) {
              setError(errorMessage(response.fieldErrors[0]?.code ?? response.error));
              return;
            }
            setResult(response.data);
          })
        }
      >
        {t('submit')}
      </Button>
    </div>
  );
}
