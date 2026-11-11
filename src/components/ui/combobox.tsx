'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { matchesFolded } from '@/lib/text';
import { cn } from '@/lib/utils';

import { fieldBase } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = { value: string; label: string; keywords?: string[] };

export type ComboboxProps = {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  className?: string;
};

/**
 * Searchable select for long lists such as provinces and wards (§8.1). Matching ignores
 * Vietnamese accents: "ho chi minh" finds "Thành phố Hồ Chí Minh".
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  id,
  invalid,
  className,
}: ComboboxProps) {
  const t = useTranslations('ui.combobox');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            fieldBase,
            'flex min-h-11 items-center justify-between gap-2 py-2 text-left',
            !selected && 'text-taupe-600',
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder ?? t('placeholder')}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-taupe-600" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <CommandPrimitive
          filter={(itemValue, search, keywords) =>
            matchesFolded([itemValue, ...(keywords ?? [])].join(' '), search) ? 1 : 0
          }
        >
          <CommandPrimitive.Input
            placeholder={searchPlaceholder ?? t('search')}
            className="border-line-200 h-11 w-full border-b bg-transparent px-3 outline-none placeholder:text-taupe-300"
          />
          <CommandPrimitive.List id={listId} className="max-h-72 overflow-y-auto p-1">
            <CommandPrimitive.Empty className="text-small px-3 py-6 text-center text-taupe-600">
              {emptyText ?? t('empty')}
            </CommandPrimitive.Empty>
            {options.map((option) => (
              <CommandPrimitive.Item
                key={option.value}
                value={option.label}
                keywords={option.keywords}
                onSelect={() => {
                  onValueChange(option.value === value ? null : option.value);
                  setOpen(false);
                }}
                className="data-[selected=true]:bg-sand-100 relative flex min-h-10 cursor-default items-center py-2 pr-8 pl-3 outline-none select-none"
              >
                {option.label}
                {option.value === value && (
                  <Check aria-hidden className="absolute right-2 size-4" />
                )}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
