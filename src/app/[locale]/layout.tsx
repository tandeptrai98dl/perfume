import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { CookieConsent } from '@/components/privacy/cookie-consent';
import { Toaster } from '@/components/ui/toaster';
import { routing } from '@/i18n/routing';
import { cookieConsentPaintScript } from '@/lib/privacy/cookie-consent';
import { OG_LOCALES } from '@/lib/seo/content-metadata';

import '../fonts';
import '../globals.css';

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

  return (
    // suppressHydrationWarning: the pre-paint script below may set an attribute on <html>.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Before first paint: hides the static-shell cookie banner for returning visitors. */}
        <script dangerouslySetInnerHTML={{ __html: cookieConsentPaintScript() }} />
      </head>
      <body>
        <NextIntlClientProvider>
          {children}
          {/* M3 privacy: cookie banner + preferences and the consent-gated tag loader. */}
          <CookieConsent locale={locale} />
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
