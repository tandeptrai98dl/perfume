'use client';

import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useId, useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

/** FilterBar control bound to one URL param (e.g. `status`); changing it resets the page. */
export function FilterSelect({
  param,
  label,
  allLabel,
  options,
}: {
  param: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  const [, startTransition] = useTransition();
  const [values, setValues] = useQueryStates(
    { [param]: parseAsString.withDefault(''), page: parseAsInteger },
    { shallow: false, startTransition },
  );
  const value = (values[param] as string) || ALL;
  return (
    <div className="flex w-48 flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      <Select
        value={value}
        onValueChange={(next) =>
          void setValues({ [param]: next === ALL ? null : next, page: null })
        }
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
