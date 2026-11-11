'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';

/** Customers only: staff accounts are refused on the OAuth callback (server-side rule). */
export function GoogleButton({ callbackURL, errorURL }: { callbackURL: string; errorURL: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({
          provider: 'google',
          callbackURL,
          errorCallbackURL: errorURL,
        });
        if (error) setPending(false);
      }}
    >
      {t('google')}
    </Button>
  );
}

export function AuthDivider() {
  const t = useTranslations('auth');
  return (
    <div className="flex items-center gap-3 text-taupe-600" aria-hidden>
      <span className="bg-line-200 h-px flex-1" />
      <span className="text-small">{t('or')}</span>
      <span className="bg-line-200 h-px flex-1" />
    </div>
  );
}
