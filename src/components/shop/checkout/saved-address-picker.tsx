'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';

import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { formatVietnamesePhone } from '@/lib/phone';

import type { SavedAddress } from './types';

export const NEW_ADDRESS = 'new';

/** Address book of a signed-in member (read-only here; the account pages manage it). */
export function SavedAddressPicker({
  addresses,
  value,
  onValueChange,
}: {
  addresses: SavedAddress[];
  value: string;
  onValueChange: (id: string) => void;
}) {
  const t = useTranslations('checkout.address');
  const locale = useLocale();
  const legendId = useId();
  if (addresses.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <p id={legendId} className="text-small font-medium">
        {t('savedLegend')}
      </p>
      <RadioGroup aria-labelledby={legendId} value={value} onValueChange={onValueChange}>
        {addresses.map((address) => {
          const ward = locale === 'vi' ? address.wardName : address.wardNameAscii;
          const province = locale === 'vi' ? address.provinceName : address.provinceNameAscii;
          return (
            <RadioCard
              key={address.id}
              value={address.id}
              title={`${address.fullName} · ${formatVietnamesePhone(address.phone)}`}
              description={[address.street, ward, province].join(', ')}
            />
          );
        })}
        <RadioCard value={NEW_ADDRESS} title={t('newAddress')} />
      </RadioGroup>
    </div>
  );
}
