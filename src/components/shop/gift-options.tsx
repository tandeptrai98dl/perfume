'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { updateGiftOptions } from '@/actions/cart';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Locale } from '@/i18n/routing';
import type { CartView } from '@/server/modules/cart';

import { useCartErrorMessage } from './use-cart-error';

const MAX_MESSAGE = 200;

/** Gift wrap (fee from settings), card message ≤ 200 characters, hide prices (§10.3). */
export function GiftOptions({
  gift,
  onView,
}: {
  gift: CartView['gift'];
  onView?: (view: CartView) => void;
}) {
  const t = useTranslations('cart.gift');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const errorMessage = useCartErrorMessage();
  const ids = { wrap: useId(), message: useId(), hint: useId(), hide: useId() };
  const [wrap, setWrap] = useState(gift.wrap);
  const [message, setMessage] = useState(gift.message ?? '');
  const [hidePrices, setHidePrices] = useState(gift.hidePrices);
  const [pending, startTransition] = useTransition();

  const length = [...message.normalize('NFC')].length;
  const tooLong = length > MAX_MESSAGE;
  const dirty =
    wrap !== gift.wrap || hidePrices !== gift.hidePrices || message.trim() !== (gift.message ?? '');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooLong) return;
    startTransition(async () => {
      const result = await updateGiftOptions({
        giftWrap: wrap,
        giftMessage: message,
        hidePrices,
        locale,
      });
      if (result.ok) {
        onView?.(result.data);
        toast.success(t('saved'));
      } else {
        toast.error(errorMessage(result));
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby={`${ids.wrap}-title`}>
      <h2 id={`${ids.wrap}-title`} className="eyebrow text-taupe-600">
        {t('title')}
      </h2>
      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={ids.wrap}
          checked={wrap}
          onCheckedChange={(value) => setWrap(value === true)}
        />
        <Label htmlFor={ids.wrap} className="font-normal">
          {t('wrap', { fee: format.number(gift.fee, 'vnd') })}
        </Label>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.message}>{t('message')}</Label>
        <Textarea
          id={ids.message}
          value={message}
          rows={3}
          onChange={(event) => setMessage(event.target.value)}
          aria-describedby={ids.hint}
          aria-invalid={tooLong || undefined}
        />
        <p
          id={ids.hint}
          className={tooLong ? 'text-small text-danger' : 'text-small text-taupe-600'}
          aria-live="polite"
        >
          {tooLong
            ? t('tooLong', { max: MAX_MESSAGE })
            : t('messageHint', { count: length, max: MAX_MESSAGE })}
        </p>
      </div>
      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={ids.hide}
          checked={hidePrices}
          onCheckedChange={(value) => setHidePrices(value === true)}
        />
        <Label htmlFor={ids.hide} className="font-normal">
          {t('hidePrices')}
        </Label>
      </div>
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        disabled={!dirty || tooLong}
        className="self-start"
      >
        {t('save')}
      </Button>
    </form>
  );
}
