'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { unsubscribeNewsletterAction } from '@/actions/newsletter';
import { FormNotice } from '@/components/account/form-message';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/** One-button unsubscribe behind the signed e-mail link. */
export function NewsletterUnsubscribe({
  subscriberId,
  signature,
  maskedEmail,
  subscribed,
}: {
  subscriberId: string;
  signature: string;
  maskedEmail: string;
  subscribed: boolean;
}) {
  const t = useTranslations('newsletter');
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(!subscribed);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <FormNotice tone="success">{t('unsubscribe.done')}</FormNotice>
        <Button asChild variant="secondary" className="self-start">
          <Link href="/">{t('unsubscribe.home')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <FormNotice tone="error">{error}</FormNotice>}
      {maskedEmail && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
          <dt className="text-taupe-600">{t('unsubscribe.email')}</dt>
          <dd className="break-all">{maskedEmail}</dd>
        </dl>
      )}
      <Button
        className="self-start"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await unsubscribeNewsletterAction({ s: subscriberId, t: signature });
            if (!result.ok) {
              setError(t(`errors.${result.error}`));
              return;
            }
            setDone(true);
          })
        }
      >
        {t('unsubscribe.submit')}
      </Button>
    </div>
  );
}
