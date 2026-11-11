'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';

export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations('admin.nav');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace('/admin/login');
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden />
      {t('signOut')}
    </Button>
  );
}
