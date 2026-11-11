import { createTranslator } from 'next-intl';

import type { Locale } from '@/i18n/routing';

import enMessages from '../../../../messages/en.json';
import viMessages from '../../../../messages/vi.json';

/*
 * Variant labels for the order snapshot ("100 ml", "Travel 10 ml"), written in the order's
 * locale with the same messages as the storefront (`catalog.variantLabel.*`). The label is not
 * stored on the variant (§6.2), so the order keeps the text the buyer saw.
 */

const MESSAGES = { vi: viMessages, en: enMessages } as const;

export type SnapshotVariantType = 'full_size' | 'travel' | 'tester' | 'gift_set' | 'decant';

export function variantLabel(locale: Locale, variantType: SnapshotVariantType, sizeMl: number) {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: 'catalog.variantLabel',
  });
  // Decants are not sold (ADR-0015); a stray one is labelled like a full size, never exposed.
  const type = variantType === 'decant' ? 'full_size' : variantType;
  return t(type, { size: sizeMl });
}
