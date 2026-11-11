'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { authClient } from '@/lib/auth/client';

type Step = 'credentials' | 'totp' | 'backup';
type ErrorKey = 'invalidCredentials' | 'invalidCode' | 'notStaff' | 'locked' | 'genericError';

const STAFF_ROLES = new Set(['owner', 'manager', 'staff', 'editor']);

/**
 * Staff sign-in: email + password, then TOTP (or a backup code). No OAuth for staff.
 * Error messages stay generic to avoid account enumeration (ARCHITECTURE.md §12).
 */
export function LoginForm() {
  const t = useTranslations('admin.login');
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  function goToAdmin() {
    router.replace('/admin');
    router.refresh();
  }

  function submitCredentials(form: FormData) {
    setError(null);
    startTransition(async () => {
      const { data, error: signInError } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      if (signInError) {
        setError(signInError.code === 'ACCOUNT_LOCKED' ? 'locked' : 'invalidCredentials');
        return;
      }
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        setStep('totp');
        return;
      }
      // Signed in without a second factor: only staff still enrolling may continue.
      const role = data && 'user' in data ? (data.user as { role?: string }).role : undefined;
      if (!role || !STAFF_ROLES.has(role)) {
        await authClient.signOut();
        setError('notStaff');
        return;
      }
      router.replace('/admin/two-factor');
    });
  }

  function submitCode(form: FormData) {
    setError(null);
    const code = String(form.get('code') ?? '').replace(/\s+/g, '');
    startTransition(async () => {
      const result =
        step === 'backup'
          ? await authClient.twoFactor.verifyBackupCode({ code })
          : await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(result.error.code === 'ACCOUNT_LOCKED' ? 'locked' : 'invalidCode');
        return;
      }
      goToAdmin();
    });
  }

  const errorMessage = error ? (
    <p role="alert" aria-live="assertive">
      {t(error)}
    </p>
  ) : null;

  if (step === 'credentials') {
    return (
      <form action={submitCredentials} className="flex flex-col gap-4" noValidate>
        <label htmlFor={`${id}-email`} className="flex flex-col gap-1">
          {t('email')}
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="username"
            required
            className="border p-2"
          />
        </label>
        <label htmlFor={`${id}-password`} className="flex flex-col gap-1">
          {t('password')}
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="border p-2"
          />
        </label>
        {errorMessage}
        <button type="submit" disabled={pending} className="border p-2">
          {t('submit')}
        </button>
      </form>
    );
  }

  return (
    <form action={submitCode} className="flex flex-col gap-4" noValidate>
      <h2 className="text-xl">{t('totpTitle')}</h2>
      {step === 'totp' && <p>{t('totpHint')}</p>}
      <label htmlFor={`${id}-code`} className="flex flex-col gap-1">
        {step === 'backup' ? t('backupCode') : t('totpCode')}
        <input
          id={`${id}-code`}
          name="code"
          type="text"
          inputMode={step === 'backup' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          autoFocus
          className="border p-2"
        />
      </label>
      {errorMessage}
      <button type="submit" disabled={pending} className="border p-2">
        {t('verify')}
      </button>
      <button
        type="button"
        className="underline"
        onClick={() => {
          setError(null);
          setStep(step === 'backup' ? 'totp' : 'backup');
        }}
      >
        {step === 'backup' ? t('useTotp') : t('useBackupCode')}
      </button>
    </form>
  );
}
