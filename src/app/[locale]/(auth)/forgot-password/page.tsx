import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/account/auth-forms';

import { AuthHeader, authLocale, authMetadata } from '../_lib/auth-page';

type Props = PageProps<'/[locale]/forgot-password'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return authMetadata(params, 'forgot');
}

/** Password reset request (§10.6): same answer whether or not the e-mail has an account. */
export default async function ForgotPasswordPage({ params }: Props) {
  const locale = await authLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.forgot' });
  return (
    <>
      <AuthHeader title={t('title')} intro={t('intro')} />
      <ForgotPasswordForm />
    </>
  );
}
