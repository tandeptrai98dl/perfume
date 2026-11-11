import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { CartView } from '@/server/modules/cart';

/** "X ₫ away from free shipping" with a quiet progress rule (§10.3). */
export function FreeShippingProgress({
  progress,
  className,
}: {
  progress: CartView['freeShipping'];
  className?: string;
}) {
  const t = useTranslations('cart.freeShipping');
  const format = useFormatter();
  if (!progress) return null;
  const text = progress.unlocked
    ? t('unlocked')
    : t('remaining', { amount: format.number(progress.remaining, 'vnd') });
  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="free-shipping-progress">
      <p className="text-small" aria-live="polite">
        {text}
      </p>
      <div
        role="progressbar"
        aria-label={t('label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={text}
        className="bg-line-200 h-0.5 w-full overflow-hidden"
      >
        <div
          className={cn(
            'ease-luxe h-full transition-[width] duration-(--duration-panel)',
            progress.unlocked ? 'bg-success' : 'bg-gold-500',
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
