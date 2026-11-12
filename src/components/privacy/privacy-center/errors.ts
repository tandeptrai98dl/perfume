'use client';

import { useTranslations } from 'next-intl';

/** Translates privacy action error codes (`privacyCenter.errors.<code>`). */
export function usePrivacyError() {
  const t = useTranslations('privacyCenter.errors');
  return (code: string | null | undefined): string => {
    if (!code) return t('unexpected');
    return t.has(code as 'unexpected') ? t(code as 'unexpected') : t('unexpected');
  };
}
