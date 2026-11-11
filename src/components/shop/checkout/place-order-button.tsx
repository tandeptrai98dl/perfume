'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/** Submit button that stays locked while the order is being placed (§10.4 duplicate guard). */
export function PlaceOrderButton({
  placing,
  paysOnline,
}: {
  placing: boolean;
  paysOnline: boolean;
}) {
  const t = useTranslations('checkout');
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        loading={placing}
        className="w-full"
        data-testid="place-order"
      >
        {!placing && <Lock aria-hidden />}
        {placing ? t('placing') : paysOnline ? t('placeOrderPay') : t('placeOrder')}
      </Button>
      <p className="text-small text-center text-taupe-600">{t('placeHint')}</p>
    </div>
  );
}
