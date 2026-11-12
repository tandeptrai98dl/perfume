import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SetPasswordForm } from '@/components/admin/set-password-form';

/** Landing page of the staff invitation e-mail (§11.2): no session required. */
export default async function AdminSetPasswordPage(props: PageProps<'/admin/set-password'>) {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.setPassword' });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-h1">{t('title')}</h1>
      <p>{t('intro')}</p>
      <Suspense>
        <Form {...props} />
      </Suspense>
    </main>
  );
}

async function Form({ searchParams }: PageProps<'/admin/set-password'>) {
  const { token } = await searchParams;
  const value = typeof token === 'string' && /^[\w-]{16,200}$/.test(token) ? token : null;
  return <SetPasswordForm token={value} />;
}
