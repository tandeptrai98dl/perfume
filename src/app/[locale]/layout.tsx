import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { CookieConsent } from '@/components/privacy/cookie-consent';
import { announcementPaintScript } from '@/components/shop/announcement-cookie';
import { Toaster } from '@/components/ui/toaster';
import { routing } from '@/i18n/routing';
import { cookieConsentPaintScript } from '@/lib/privacy/cookie-consent';
import { OG_LOCALES } from '@/lib/seo/content-metadata';

import '../fonts';
import '../globals.css';

/**
 * Namespaces never read by storefront client components: the admin UI has its own provider
 * (app/admin/layout.tsx) and e-mails render on the server. Leaving them out keeps ~70 KB of
 * Vietnamese strings (sent twice: static shell + streamed payload) out of every storefront
 * page's HTML (§14.1). Server Components still read every namespace via getTranslations.
 */
const SERVER_ONLY_NAMESPACES = new Set(['admin', 'email']);

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: { default: t('defaultTitle'), template: `%s | ${t('siteName')}` },
    description: t('defaultDescription'),
    // Defaults for pages without their own Open Graph data (§13.1).
    openGraph: {
      type: 'website',
      siteName: t('siteName'),
      title: t('defaultTitle'),
      description: t('defaultDescription'),
      locale: OG_LOCALES[locale],
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = Object.fromEntries(
    Object.entries(await getMessages({ locale })).filter(
      ([namespace]) => !SERVER_ONLY_NAMESPACES.has(namespace),
    ),
  );

  return (
    // suppressHydrationWarning: the pre-paint script below may set attributes on <html>.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Before first paint: hides the static-shell cookie banner for returning visitors and
            the announcement placeholder after a dismissal (see globals.css). */}
        <script
          dangerouslySetInnerHTML={{
            __html: cookieConsentPaintScript() + announcementPaintScript(),
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          {/* M3 privacy: cookie banner + preferences and the consent-gated tag loader. First in
              <body> (GOV.UK cookie banner pattern: announced before the skip link and the
              page) and so parsed before the async page scripts run, which lets the banner
              paint with the first frame instead of after script evaluation (LCP, §14.1). It is
              fixed to the bottom of the viewport, so the visual order is unchanged. */}
          <CookieConsent locale={locale} />
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
