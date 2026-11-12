import type { Route } from 'next';
import NextLink from 'next/link';
import { RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';

const ITEMS = [
  { key: 'authentic', Icon: ShieldCheck },
  { key: 'returns', Icon: RotateCcw },
  { key: 'delivery', Icon: Truck },
] as const;

export type TrustStripLinks = Record<(typeof ITEMS)[number]['key'], string | null>;

/**
 * TrustStrip (§8.3): authentic, returns, fast delivery, each linking to the page that backs
 * the promise (authenticity page, returns and shipping policies of the current locale).
 */
export async function TrustStrip({ locale, links }: { locale: Locale; links: TrustStripLinks }) {
  const t = await getTranslations({ locale, namespace: 'home.trust' });
  return (
    <section aria-labelledby="home-trust" className="border-line-200 border-y">
      <h2 id="home-trust" className="sr-only">
        {t('title')}
      </h2>
      <ul className="container-content grid gap-6 py-8 md:grid-cols-3 md:gap-8">
        {ITEMS.map(({ key, Icon }) => {
          const href = links[key];
          return (
            <li key={key} className="flex items-start gap-4" data-testid={`trust-${key}`}>
              <Icon aria-hidden className="text-gold-700 mt-1 size-6 shrink-0" strokeWidth={1.5} />
              <div className="flex flex-col gap-1">
                <h3 className="font-display text-h3">{t(`${key}.title`)}</h3>
                <p className="text-small text-taupe-600">{t(`${key}.text`)}</p>
                {href && (
                  <NextLink
                    href={href as Route}
                    className="text-small text-gold-700 inline-flex min-h-11 items-center underline underline-offset-4 md:min-h-9"
                  >
                    {t(`${key}.link`)}
                  </NextLink>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
