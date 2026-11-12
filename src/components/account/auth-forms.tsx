'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Route } from 'next';
import { useLocale, useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TurnstileWidget, useTurnstile } from '@/components/ui/turnstile-widget';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { authClient } from '@/lib/auth/client';
import { localizedPath } from '@/lib/seo/paths';
import { TURNSTILE_ACTIONS, TURNSTILE_TOKEN_HEADER } from '@/lib/turnstile';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from '@/lib/validation/account';

import { AccountFormMessage, FormNotice } from './form-message';
import { PasswordInput } from './password-input';

/*
 * Customer authentication forms (§10.6, §12): React Hook Form + Zod, Better Auth client.
 * Messages never reveal whether an e-mail has an account (generic errors and answers).
 */

type AuthError = { status?: number; code?: string } | null | undefined;

function isRateLimited(error: AuthError) {
  return error?.status === 429;
}

function isCaptchaFailed(error: AuthError) {
  return error?.code === 'CAPTCHA_FAILED';
}

/** Better Auth request options carrying the Turnstile token (verified in a server hook). */
function captchaOptions(token: string | null) {
  return token ? { headers: { [TURNSTILE_TOKEN_HEADER]: token } } : undefined;
}

export function SignInForm({
  next,
  initialNotice,
}: {
  next: string;
  initialNotice?: 'verifyFailed' | 'oauth';
}) {
  const t = useTranslations('auth');
  const tSecurity = useTranslations('security');
  const router = useRouter();
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.signIn);
  const form = useForm<z.input<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const [notice, setNotice] = useState<
    | 'invalidCredentials'
    | 'notVerified'
    | 'locked'
    | 'staffAccount'
    | 'tooManyRequests'
    | 'verifyFailed'
    | 'captchaFailed'
    | 'genericError'
    | null
  >(
    initialNotice === 'verifyFailed'
      ? 'verifyFailed'
      : initialNotice === 'oauth'
        ? 'genericError'
        : null,
  );

  async function onSubmit(values: z.output<typeof signInSchema>) {
    setNotice(null);
    const { data, error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      // Where the verification link (re-sent to unverified accounts) returns to.
      callbackURL: next,
      fetchOptions: captchaOptions(turnstile.token),
    });
    turnstile.reset();
    if (error) {
      if (isRateLimited(error)) setNotice('tooManyRequests');
      else if (isCaptchaFailed(error)) setNotice('captchaFailed');
      else if (error.code === 'EMAIL_NOT_VERIFIED') setNotice('notVerified');
      else if (error.code === 'ACCOUNT_LOCKED') setNotice('locked');
      else setNotice('invalidCredentials');
      return;
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      setNotice('staffAccount');
      return;
    }
    router.replace(next as Route);
    router.refresh();
  }

  let noticeText: ReactNode = null;
  if (notice === 'tooManyRequests' || notice === 'genericError') noticeText = t(notice);
  else if (notice === 'captchaFailed') noticeText = tSecurity('captchaFailed');
  else if (notice === 'staffAccount') {
    noticeText = t.rich('signIn.staffAccount', {
      link: (chunks) => (
        <NextLink href="/admin/login" className="text-gold-700 underline">
          {chunks}
        </NextLink>
      ),
    });
  } else if (notice) noticeText = t(`signIn.${notice}`);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {noticeText && (
          <FormNotice tone={notice === 'notVerified' ? 'info' : 'error'}>{noticeText}</FormNotice>
        )}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" inputMode="email" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-baseline justify-between gap-4">
                <FormLabel>{t('fields.password')}</FormLabel>
                <Link href="/forgot-password" className="text-small text-gold-700 hover:underline">
                  {t('signIn.forgot')}
                </Link>
              </div>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <TurnstileWidget {...turnstile.widgetProps} />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('signIn.submit')}
        </Button>
      </form>
    </Form>
  );
}

export function SignUpForm({ verifyCallback }: { verifyCallback: string }) {
  const t = useTranslations('auth');
  const tSecurity = useTranslations('security');
  const locale = useLocale() as Locale;
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.signUp);
  const form = useForm<z.input<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<'tooManyRequests' | 'captchaFailed' | 'genericError' | null>(
    null,
  );

  async function onSubmit(values: z.output<typeof signUpSchema>) {
    setNotice(null);
    const { error } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
      // Account e-mails use the language the customer signed up in (changeable in the profile).
      locale,
      callbackURL: verifyCallback,
      fetchOptions: captchaOptions(turnstile.token),
    } as Parameters<typeof authClient.signUp.email>[0]);
    turnstile.reset();
    if (error) {
      setNotice(
        isRateLimited(error)
          ? 'tooManyRequests'
          : isCaptchaFailed(error)
            ? 'captchaFailed'
            : 'genericError',
      );
      return;
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h2 className="text-h2">{t('signUp.checkEmailTitle')}</h2>
        <p>{t('signUp.checkEmail', { email: sentTo })}</p>
        <Link href="/sign-in" className="text-gold-700 hover:underline">
          {t('signUp.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {notice && (
          <FormNotice tone="error">
            {notice === 'captchaFailed' ? tSecurity(notice) : t(notice)}
          </FormNotice>
        )}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" inputMode="email" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.password')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{t('fields.passwordHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <p className="text-small text-taupe-600">{t('signUp.terms')}</p>
        <TurnstileWidget {...turnstile.widgetProps} />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('signUp.submit')}
        </Button>
      </form>
    </Form>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tSecurity = useTranslations('security');
  const locale = useLocale() as Locale;
  const turnstile = useTurnstile(TURNSTILE_ACTIONS.forgotPassword);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<'tooManyRequests' | 'captchaFailed' | null>(null);

  async function onSubmit(values: z.output<typeof forgotPasswordSchema>) {
    setNotice(null);
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: localizedPath(locale, '/reset-password'),
      fetchOptions: captchaOptions(turnstile.token),
    });
    turnstile.reset();
    // Same answer whether or not the e-mail has an account; only throttling is shown.
    if (isRateLimited(error)) {
      setNotice('tooManyRequests');
      return;
    }
    if (isCaptchaFailed(error)) {
      setNotice('captchaFailed');
      return;
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h2 className="text-h2">{t('forgot.sentTitle')}</h2>
        <p>{t('forgot.sent', { email: sentTo })}</p>
        <Link href="/sign-in" className="text-gold-700 hover:underline">
          {t('forgot.back')}
        </Link>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {notice && (
          <FormNotice tone="error">
            {notice === 'captchaFailed' ? tSecurity(notice) : t(notice)}
          </FormNotice>
        )}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" inputMode="email" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <TurnstileWidget {...turnstile.widgetProps} />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('forgot.submit')}
        </Button>
        <Link href="/sign-in" className="text-small text-gold-700 hover:underline">
          {t('forgot.back')}
        </Link>
      </form>
    </Form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations('auth');
  const form = useForm<z.input<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid');

  async function onSubmit(values: z.output<typeof resetPasswordSchema>) {
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token: token!,
    });
    setState(error ? 'invalid' : 'done');
  }

  if (state === 'invalid') {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice tone="error">{t('reset.invalidToken')}</FormNotice>
        <Button asChild variant="secondary">
          <Link href="/forgot-password">{t('reset.requestNew')}</Link>
        </Button>
      </div>
    );
  }
  if (state === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice tone="success">{t('reset.done')}</FormNotice>
        <Button asChild>
          <Link href="/sign-in">{t('reset.signIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.newPassword')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{t('fields.passwordHint')}</FormDescription>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.confirmPassword')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <AccountFormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('reset.submit')}
        </Button>
      </form>
    </Form>
  );
}
