'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TurnstileWidget, useTurnstile } from '@/components/ui/turnstile-widget';
import { authClient } from '@/lib/auth/client';
import { TURNSTILE_ACTIONS, TURNSTILE_TOKEN_HEADER } from '@/lib/turnstile';

type Step = 'credentials' | 'totp' | 'backup';
type ErrorKey =
  'invalidCredentials' | 'invalidCode' | 'notStaff' | 'locked' | 'captchaFailed' | 'genericError';

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
  // Same /sign-in/email endpoint as customers, so the same Turnstile check (§12).
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.signIn);

  function goToAdmin() {
    router.replace('/admin');
    router.refresh();
  }

  function submitCredentials(form: FormData) {
    setError(null);
    startTransition(async () => {
      const token = turnstile.token;
      const { data, error: signInError } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        fetchOptions: token ? { headers: { [TURNSTILE_TOKEN_HEADER]: token } } : undefined,
      });
      turnstile.reset();
      if (signInError) {
        setError(
          signInError.code === 'ACCOUNT_LOCKED'
            ? 'locked'
            : signInError.code === 'CAPTCHA_FAILED'
              ? 'captchaFailed'
              : 'invalidCredentials',
        );
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
    <p role="alert" aria-live="assertive" className="text-small text-danger">
      {t(error)}
    </p>
  ) : null;

  if (step === 'credentials') {
    return (
      <form action={submitCredentials} className="flex flex-col gap-4" noValidate>
        <label htmlFor={`${id}-email`} className="text-small flex flex-col gap-2 font-medium">
          {t('email')}
          <Input id={`${id}-email`} name="email" type="email" autoComplete="username" required />
        </label>
        <label htmlFor={`${id}-password`} className="text-small flex flex-col gap-2 font-medium">
          {t('password')}
          <Input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
          />
        </label>
        <TurnstileWidget {...turnstile.widgetProps} />
        {errorMessage}
        <Button type="submit" loading={pending}>
          {t('submit')}
        </Button>
      </form>
    );
  }

  return (
    <form action={submitCode} className="flex flex-col gap-4" noValidate>
      <h2 className="text-h3">{t('totpTitle')}</h2>
      {step === 'totp' && <p>{t('totpHint')}</p>}
      <label htmlFor={`${id}-code`} className="text-small flex flex-col gap-2 font-medium">
        {step === 'backup' ? t('backupCode') : t('totpCode')}
        <Input
          id={`${id}-code`}
          name="code"
          type="text"
          inputMode={step === 'backup' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </label>
      {errorMessage}
      <Button type="submit" loading={pending}>
        {t('verify')}
      </Button>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          setError(null);
          setStep(step === 'backup' ? 'totp' : 'backup');
        }}
      >
        {step === 'backup' ? t('useTotp') : t('useBackupCode')}
      </Button>
    </form>
  );
}
