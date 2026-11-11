'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { authClient } from '@/lib/auth/client';

export function SignOutButton() {
  const t = useTranslations('admin.nav');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace('/admin/login');
          router.refresh();
        })
      }
    >
      {t('signOut')}
    </button>
  );
}
