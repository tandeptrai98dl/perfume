import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** One numbered block of the one-page checkout (§10.4: contact → address → shipping → payment). */
export function CheckoutSection({
  step,
  title,
  aside,
  className,
  children,
}: {
  step: number;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('border-line-200 flex flex-col gap-5 border-t pt-6', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-h3 flex items-baseline gap-3">
          <span aria-hidden className="eyebrow text-gold-700">
            {String(step).padStart(2, '0')}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
