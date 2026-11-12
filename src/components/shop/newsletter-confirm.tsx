'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { confirmNewsletterAction } from '@/actions/newsletter';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/** The explicit "Confirm subscription" step of the double opt-in. */
export function NewsletterConfirm({ token, email }: { token: string; email: string }) {
  const t = useTranslations('newsletter');
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<'subscribed' | 'already' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <FormNotice tone="success">
          {done === 'already' ? t('confirm.already') : t('confirm.done')}
        </FormNotice>
        <Button asChild variant="secondary" className="self-start">
          <Link href="/perfumes">{t('confirm.shop')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-taupe-600">{t('confirm.email')}</dt>
        <dd className="break-all">{email}</dd>
      </dl>
      <Button
        className="self-start"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmNewsletterAction({ token });
            if (!result.ok) {
              setError(t(`errors.${result.error}`));
              return;
            }
            setDone(result.data.alreadySubscribed ? 'already' : 'subscribed');
          })
        }
      >
        {t('confirm.submit')}
      </Button>
    </div>
  );
}
