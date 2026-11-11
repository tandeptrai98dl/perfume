import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/** Number of results; announced politely when filters change. */
export function ResultCount({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('listing');
  return (
    <p role="status" aria-live="polite" className={cn('text-small text-taupe-600', className)}>
      {t('resultCount', { count })}
    </p>
  );
}
