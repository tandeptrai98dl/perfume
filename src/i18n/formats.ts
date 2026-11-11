import type { Formats } from 'next-intl';

/** Shared number/date formats. Money is always VND (ADR-0001). */
export const formats = {
  number: {
    vnd: { style: 'currency', currency: 'VND', maximumFractionDigits: 0 },
  },
} satisfies Formats;
