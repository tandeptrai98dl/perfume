'use client';

import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type QuantityStepperProps = {
  value: number;
  /** Lowest allowed quantity (default 1). */
  min?: number;
  /** Bounded by available stock and the per-line cap. */
  max: number;
  /** Fires after the user stops changing the value for `debounceMs` (cart updates). */
  onCommit: (value: number) => void;
  debounceMs?: number;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function QuantityStepper({
  value,
  min = 1,
  max,
  onCommit,
  debounceMs = 400,
  disabled,
  label,
  className,
}: QuantityStepperProps) {
  const t = useTranslations('ui.quantity');
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adopt a new value from the server (e.g. after the cart re-renders).
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(next: number) {
    const bounded = Math.min(max, Math.max(min, next));
    setDraft(bounded);
    clearTimeout(timer.current);
    if (bounded !== value) timer.current = setTimeout(() => onCommit(bounded), debounceMs);
  }

  const buttonClass =
    'inline-flex size-11 items-center justify-center hover:bg-sand-100 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4';

  return (
    <div
      role="group"
      aria-label={label ?? t('label')}
      className={cn('border-line-200 inline-flex items-center border bg-white', className)}
    >
      <button
        type="button"
        className={buttonClass}
        aria-label={t('decrease')}
        disabled={disabled || draft <= min}
        onClick={() => change(draft - 1)}
      >
        <Minus aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={t('value')}
        className="h-11 w-12 [appearance:textfield] bg-transparent text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (!Number.isNaN(parsed)) change(parsed);
        }}
      />
      <button
        type="button"
        className={buttonClass}
        aria-label={t('increase')}
        disabled={disabled || draft >= max}
        onClick={() => change(draft + 1)}
      >
        <Plus aria-hidden />
      </button>
      <span aria-live="polite" className="sr-only">
        {draft >= max ? t('maxReached', { max }) : ''}
      </span>
    </div>
  );
}
