import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import * as rootParams from 'next/root-params';

import { formats } from './formats';
import { routing } from './routing';

export default getRequestConfig(async ({ locale }) => {
  let resolved = locale;
  if (!resolved) {
    const paramValue = await rootParams.locale();
    if (hasLocale(routing.locales, paramValue)) {
      resolved = paramValue;
    } else {
      notFound();
    }
  }

  return {
    locale: resolved,
    messages: (await import(`../../messages/${resolved}.json`)).default,
    timeZone: 'Asia/Ho_Chi_Minh',
    formats,
  };
});
