import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { TranslationStatus } from '@/server/modules/catalog';

/** Per-locale translation state (ADR-0021): missing, draft (not published) or published. */
export function TranslationStatusBadge({
  locale,
  status,
  compact = false,
}: {
  locale: 'vi' | 'en';
  status: TranslationStatus;
  compact?: boolean;
}) {
  const t = useTranslations('admin.translation');
  const variant = status === 'published' ? 'success' : status === 'draft' ? 'outline' : 'warning';
  const label = t(`status.${status}`);
  return (
    <Badge variant={variant} title={`${t(`locale.${locale}`)}: ${label}`}>
      {compact ? (
        <>
          <span aria-hidden>{locale.toUpperCase()}</span>
          <span className="sr-only">
            {t(`locale.${locale}`)}: {label}
          </span>
        </>
      ) : (
        <>
          {locale.toUpperCase()} · {label}
        </>
      )}
    </Badge>
  );
}
