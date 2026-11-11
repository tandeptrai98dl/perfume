'use client';

import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useId, useTransition } from 'react';

import { Input } from '@/components/ui/input';

/** FilterBar date range bound to `?from=&to=` (inclusive Vietnam-time dates). */
export function DateRangeFilter() {
  const t = useTranslations('admin.orders.filters');
  const id = useId();
  const [, startTransition] = useTransition();
  const [values, setValues] = useQueryStates(
    {
      from: parseAsString.withDefault(''),
      to: parseAsString.withDefault(''),
      page: parseAsInteger,
    },
    { shallow: false, startTransition },
  );
  return (
    <>
      <div className="flex w-40 flex-col gap-2">
        <label htmlFor={`${id}-from`} className="text-small font-medium">
          {t('from')}
        </label>
        <Input
          id={`${id}-from`}
          type="date"
          value={values.from}
          max={values.to || undefined}
          onChange={(event) => void setValues({ from: event.target.value || null, page: null })}
        />
      </div>
      <div className="flex w-40 flex-col gap-2">
        <label htmlFor={`${id}-to`} className="text-small font-medium">
          {t('to')}
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={values.to}
          min={values.from || undefined}
          onChange={(event) => void setValues({ to: event.target.value || null, page: null })}
        />
      </div>
    </>
  );
}
