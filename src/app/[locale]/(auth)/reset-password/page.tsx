import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ResetPasswordForm } from '@/components/account/auth-forms';

import {
  AuthFormSkeleton,
  AuthHeader,
  authLocale,
  authMetadata,
  firstParam,
} from '../_lib/auth-page';

type Props = PageProps<'/[locale]/reset-password'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return authMetadata(params, 'reset');
}

/**
 * New password (§10.6). Better Auth checks the 30-minute token on the e-mail link and lands
 * here with `?token=` (or `?error=INVALID_TOKEN`); the token is single-use.
 */
export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const locale = await authLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.reset' });
  return (
    <>
      <AuthHeader title={t('title')} intro={t('intro')} />
      <Suspense fallback={<AuthFormSkeleton />}>
        <ResetContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ResetContent({ searchParams }: { searchParams: Props['searchParams'] }) {
  const query = await searchParams;
  const token = firstParam(query.error) ? null : (firstParam(query.token) ?? null);
  return <ResetPasswordForm token={token && /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : null} />;
}
