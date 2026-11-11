import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SignUpForm } from '@/components/account/auth-forms';
import { AuthDivider, GoogleButton } from '@/components/account/google-button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';
import { localizedPath } from '@/lib/seo/paths';

import {
  AuthFormSkeleton,
  AuthHeader,
  authLocale,
  authMetadata,
  nextPath,
} from '../_lib/auth-page';

type Props = PageProps<'/[locale]/sign-up'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return authMetadata(params, 'signUp');
}

/** Customer sign-up (§10.6): e-mail confirmation required before the first sign-in. */
export default async function SignUpPage({ params, searchParams }: Props) {
  const locale = await authLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.signUp' });
  return (
    <>
      <AuthHeader title={t('title')} intro={t('intro')} />
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignUpContent locale={locale} searchParams={searchParams} />
      </Suspense>
      <p className="text-small">
        {t('haveAccount')}{' '}
        <Link href="/sign-in" className="text-gold-700 hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </>
  );
}

async function SignUpContent({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Props['searchParams'];
}) {
  const next = await nextPath(locale, searchParams);
  // The confirmation link signs in and lands on the sign-in page, which forwards to `next`
  // (or shows "link expired" when Better Auth appends `?error=`).
  const verifyCallback = `${localizedPath(locale, '/sign-in')}?next=${encodeURIComponent(next)}`;
  const google = Boolean(serverEnv().GOOGLE_CLIENT_ID);
  return (
    <div className="flex flex-col gap-6">
      {google && (
        <>
          <GoogleButton callbackURL={next} errorURL={verifyCallback} />
          <AuthDivider />
        </>
      )}
      <SignUpForm verifyCallback={verifyCallback} />
    </div>
  );
}
