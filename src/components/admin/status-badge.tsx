import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

import type messages from '../../../messages/vi.json';

export type AdminStatus = keyof (typeof messages)['admin']['status'];
type Tone = 'neutral' | 'outline' | 'gold' | 'success' | 'warning' | 'dark';

/** Status → badge tone. Labels come from `admin.status.<status>`. */
const TONES: Record<AdminStatus, Tone> = {
  draft: 'outline',
  active: 'success',
  archived: 'neutral',
  published: 'success',
  missing: 'warning',
  inactive: 'neutral',
  low: 'warning',
  out: 'warning',
  visible: 'success',
  hidden: 'neutral',
};

export function StatusBadge({ status, label }: { status: AdminStatus; label?: string }) {
  const t = useTranslations('admin.status');
  return (
    <Badge variant={TONES[status]} data-status={status}>
      {label ?? t(status)}
    </Badge>
  );
}
