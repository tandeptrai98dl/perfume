'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { requestGuestPrivacyAction } from '@/actions/privacy';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

import { usePrivacyError } from './privacy-center/errors';

const TYPES = [
  ['export', 'export'],
  ['correct', 'correct'],
  ['delete', 'delete'],
  ['withdraw_consent', 'withdrawConsent'],
] as const;

type RequestType = (typeof TYPES)[number][0];

/** Public data-subject request form; a confirmation link is e-mailed (same answer for all). */
export function GuestRequestForm() {
  const t = useTranslations('privacyRequest.form');
  const tTypes = useTranslations('privacyCenter.requests.types');
  const errorMessage = usePrivacyError();
  const locale = useLocale() as 'vi' | 'en';
  const id = useId();
  const [email, setEmail] = useState('');
  const [type, setType] = useState<RequestType>('export');
  const [details, setDetails] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice tone="success">{t('sent')}</FormNotice>
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setSent(false);
            setDetails('');
          }}
        >
          {t('another')}
        </Button>
      </div>
    );
  }

  return (
    <form
      method="post"
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        startTransition(async () => {
          const result = await requestGuestPrivacyAction({ email, type, details, locale });
          if (result.ok) {
            setSent(true);
            return;
          }
          if (result.error === 'validation') {
            setFieldErrors(
              Object.fromEntries(result.fieldErrors.map((issue) => [issue.path, issue.code])),
            );
            return;
          }
          setError(errorMessage(result.error));
        });
      }}
    >
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-email`}>{t('email')}</Label>
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={`${id}-email-hint${fieldErrors.email ? ` ${id}-email-error` : ''}`}
          className="max-w-md"
        />
        <p id={`${id}-email-hint`} className="text-small text-taupe-600">
          {t('emailHint')}
        </p>
        {fieldErrors.email && (
          <p id={`${id}-email-error`} role="alert" className="text-small text-danger">
            {errorMessage(fieldErrors.email)}
          </p>
        )}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-small mb-2 font-medium">{t('type')}</legend>
        <RadioGroup
          value={type}
          onValueChange={(value) => setType(value as RequestType)}
          className="flex flex-col gap-1"
        >
          {TYPES.map(([value, key]) => (
            <div key={value} className="flex min-h-11 items-start gap-3">
              <RadioGroupItem value={value} id={`${id}-type-${value}`} className="mt-3" />
              <Label
                htmlFor={`${id}-type-${value}`}
                className="flex min-h-11 flex-col justify-center"
              >
                <span>{tTypes(key)}</span>
                <span className="text-small font-normal text-taupe-600">
                  {t(`typeHints.${key}`)}
                </span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-details`}>
          {type === 'correct' ? t('detailsRequired') : t('details')}
        </Label>
        <Textarea
          id={`${id}-details`}
          value={details}
          maxLength={1000}
          onChange={(event) => setDetails(event.target.value)}
          aria-invalid={!!fieldErrors.details}
          aria-describedby={fieldErrors.details ? `${id}-details-error` : undefined}
        />
        {fieldErrors.details && (
          <p id={`${id}-details-error`} role="alert" className="text-small text-danger">
            {errorMessage(fieldErrors.details)}
          </p>
        )}
      </div>
      <Button type="submit" loading={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
