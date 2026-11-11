import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { Suspense } from 'react';

import { SignInForm } from '@/components/account/auth-forms';
import { AuthDivider, GoogleButton } from '@/components/account/google-button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';
import { localizedPath } from '@/lib/seo/paths';
import { getCustomerSession } from '@/server/auth/customer';

import {
  AuthFormSkeleton,
  AuthHeader,
  authLocale,
  authMetadata,
  firstParam,
  nextPath,
} from '../_lib/auth-page';

type Props = PageProps<'/[locale]/sign-in'>;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return authMetadata(params, 'signIn');
}

/** Customer sign-in (§5.1). Returns to `?next=` (internal paths only) once signed in. */
export default async function SignInPage({ params, searchParams }: Props) {
  const locale = await authLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.signIn' });
  return (
    <>
      <AuthHeader title={t('title')} intro={t('intro')} />
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignInContent locale={locale} searchParams={searchParams} />
      </Suspense>
      <p className="text-small">
        {t('noAccount')}{' '}
        <Link href="/sign-up" className="text-gold-700 hover:underline">
          {t('createAccount')}
        </Link>
      </p>
    </>
  );
}

async function SignInContent({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Props['searchParams'];
}) {
  const next = await nextPath(locale, searchParams);
  // Already signed in (or just verified the e-mail, which signs in): continue right away.
  if (await getCustomerSession()) redirect(next as Route);
  const error = firstParam((await searchParams).error);
  const notice = error
    ? /TOKEN|USER/.test(error)
      ? ('verifyFailed' as const)
      : ('oauth' as const)
    : undefined;
  const google = Boolean(serverEnv().GOOGLE_CLIENT_ID);
  const errorURL = `${localizedPath(locale, '/sign-in')}?next=${encodeURIComponent(next)}`;
  return (
    <div className="flex flex-col gap-6">
      {google && (
        <>
          <GoogleButton callbackURL={next} errorURL={errorURL} />
          <AuthDivider />
        </>
      )}
      <SignInForm next={next} initialNotice={notice} />
    </div>
  );
}
