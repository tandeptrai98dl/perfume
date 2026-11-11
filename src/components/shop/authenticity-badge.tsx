import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/** Authenticity guarantee (§1.1): the main trust signal on product pages. */
export function AuthenticityBadge({ className }: { className?: string }) {
  const t = useTranslations('product.authenticity');
  return (
    <div className={cn('border-line-200 flex items-start gap-3 border p-4', className)}>
      <ShieldCheck aria-hidden className="text-gold-700 mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t('title')}</p>
        <p className="text-small text-taupe-600">{t('description')}</p>
      </div>
    </div>
  );
}
