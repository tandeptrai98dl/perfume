'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { authClient } from '@/lib/auth/client';

type Enrolment = { secret: string; uri: string; backupCodes: string[] };

/**
 * TOTP enrolment: re-enter the password, add the key to an authenticator app, confirm a code.
 * Confirming creates a new, 2FA-verified session.
 */
export function TwoFactorSetup() {
  const t = useTranslations('admin.twoFactor');
  const router = useRouter();
  const id = useId();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<'invalidPassword' | 'invalidCode' | null>(null);
  const [pending, startTransition] = useTransition();

  function start(form: FormData) {
    setError(null);
    startTransition(async () => {
      const { data, error: enableError } = await authClient.twoFactor.enable({
        password: String(form.get('password') ?? ''),
        method: 'totp',
      });
      if (enableError || !data || data.method !== 'totp') {
        setError('invalidPassword');
        return;
      }
      const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
      setEnrolment({ secret, uri: data.totpURI, backupCodes: data.backupCodes });
    });
  }

  function confirm(form: FormData) {
    setError(null);
    startTransition(async () => {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: String(form.get('code') ?? '').replace(/\s+/g, ''),
      });
      if (verifyError) {
        setError('invalidCode');
        return;
      }
      router.replace('/admin');
      router.refresh();
    });
  }

  const errorMessage = error ? <p role="alert">{t(error)}</p> : null;

  if (!enrolment) {
    return (
      <form action={start} className="flex flex-col gap-4">
        <label htmlFor={`${id}-password`} className="flex flex-col gap-1">
          {t('passwordLabel')}
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="border p-2"
          />
        </label>
        {errorMessage}
        <button type="submit" disabled={pending} className="border p-2">
          {t('start')}
        </button>
      </form>
    );
  }

  return (
    <form action={confirm} className="flex flex-col gap-4">
      <h2 className="text-xl">{t('scanTitle')}</h2>
      <p>{t('scanHint')}</p>
      <dl className="flex flex-col gap-2">
        <dt>{t('secretLabel')}</dt>
        <dd>
          <code className="break-all select-all">{enrolment.secret}</code>
        </dd>
        <dt>{t('uriLabel')}</dt>
        <dd>
          <code className="text-sm break-all select-all">{enrolment.uri}</code>
        </dd>
      </dl>
      <h2 className="text-xl">{t('backupTitle')}</h2>
      <p>{t('backupHint')}</p>
      <ul className="grid grid-cols-2 gap-1 font-mono">
        {enrolment.backupCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <label htmlFor={`${id}-code`} className="flex flex-col gap-1">
        {t('codeLabel')}
        <input
          id={`${id}-code`}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className="border p-2"
        />
      </label>
      {errorMessage}
      <button type="submit" disabled={pending} className="border p-2">
        {t('confirm')}
      </button>
    </form>
  );
}
