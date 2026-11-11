import { createFormatter, createTranslator } from 'next-intl';

import { formats } from '@/i18n/formats';

import enMessages from '../../../../../messages/en.json';
import viMessages from '../../../../../messages/vi.json';

/**
 * Translator and formatter for e-mail templates, without Next.js request APIs (ADR-0023).
 * Missing keys throw, so a template can never ship with a fallback key in the subject.
 */

export type EmailLocale = 'vi' | 'en';

const MESSAGES = { vi: viMessages, en: enMessages } as const;
export const EMAIL_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function emailTranslator(locale: EmailLocale) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    timeZone: EMAIL_TIME_ZONE,
    formats,
    onError(error) {
      throw error;
    },
  });
}
export type EmailTranslator = ReturnType<typeof emailTranslator>;

/** Staff alerts are Vietnamese-only, like the admin UI (`admin.*` namespace). */
export function staffTranslator() {
  return createTranslator({
    locale: 'vi',
    messages: viMessages,
    namespace: 'admin.alerts',
    timeZone: EMAIL_TIME_ZONE,
    onError(error) {
      throw error;
    },
  });
}

export function emailFormatter(locale: EmailLocale) {
  const format = createFormatter({ locale, timeZone: EMAIL_TIME_ZONE, formats });
  return {
    /** `1.250.000 ₫` (vi), `₫1,250,000` (en) — same as the storefront (§3.6). */
    money: (amount: number) => format.number(amount, 'vnd'),
    date: (value: Date) => format.dateTime(value, { dateStyle: 'long' }),
  };
}
export type EmailFormatter = ReturnType<typeof emailFormatter>;
