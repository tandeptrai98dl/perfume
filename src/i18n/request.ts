import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import * as rootParams from 'next/root-params';

import { formats } from './formats';
import { routing } from './routing';

/**
 * Locale resolution: an explicit `locale` (e.g. `getTranslations({ locale })`), else the
 * `[locale]` root param, else the default locale. Routes without a `[locale]` segment
 * (/admin is Vietnamese-only) fall back to `vi`; unknown locales are rejected with a 404
 * by `app/[locale]/layout.tsx`, not here.
 */
export default getRequestConfig(async ({ locale }) => {
  let resolved = locale;
  if (!resolved) {
    const paramValue = await rootParams.locale();
    resolved = hasLocale(routing.locales, paramValue) ? paramValue : routing.defaultLocale;
  }

  return {
    locale: resolved,
    messages: (await import(`../../messages/${resolved}.json`)).default,
    timeZone: 'Asia/Ho_Chi_Minh',
    formats,
  };
});
