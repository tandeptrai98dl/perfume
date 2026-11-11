import { getTranslations } from 'next-intl/server';

import { LoginForm } from '@/components/admin/login-form';

export default async function AdminLoginPage() {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.login' });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-h1">{t('title')}</h1>
      <LoginForm />
    </main>
  );
}
