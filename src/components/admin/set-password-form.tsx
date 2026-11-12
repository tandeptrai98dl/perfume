'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth/client';

type ErrorKey = 'tooShort' | 'mismatch' | 'invalidToken' | 'genericError';

const MIN_LENGTH = 8;

/**
 * Invited staff choose their password from the e-mailed link (Better Auth reset-password
 * token, single use). Next step: sign in, then the mandatory TOTP enrolment.
 */
export function SetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations('admin.setPassword');
  const id = useId();
  const [error, setError] = useState<ErrorKey | null>(token ? null : 'invalidToken');
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{t('done')}</p>
        <Button asChild>
          <Link href="/admin/login">{t('toLogin')}</Link>
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <p role="alert" className="text-small text-danger">
        {t('invalidToken')}
      </p>
    );
  }

  function submit(form: FormData) {
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');
    if (password.length < MIN_LENGTH) return setError('tooShort');
    if (password !== confirm) return setError('mismatch');
    setError(null);
    startTransition(async () => {
      const result = await authClient.resetPassword({ newPassword: password, token: token! });
      if (result.error) {
        setError(result.error.status === 400 ? 'invalidToken' : 'genericError');
        return;
      }
      setDone(true);
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <label htmlFor={`${id}-password`} className="text-small flex flex-col gap-2 font-medium">
        {t('password')}
        <Input
          id={`${id}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          maxLength={128}
          aria-describedby={`${id}-hint`}
          aria-invalid={error === 'tooShort' || undefined}
        />
      </label>
      <p id={`${id}-hint`} className="text-small -mt-2 text-taupe-600">
        {t('hint')}
      </p>
      <label htmlFor={`${id}-confirm`} className="text-small flex flex-col gap-2 font-medium">
        {t('confirm')}
        <Input
          id={`${id}-confirm`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
          aria-invalid={error === 'mismatch' || undefined}
        />
      </label>
      {error && (
        <p role="alert" className="text-small text-danger">
          {t(error)}
        </p>
      )}
      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
