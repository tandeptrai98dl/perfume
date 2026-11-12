import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Route } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CookieSettingsButton } from '@/components/privacy/cookie-settings-button';
import { NewsletterSignup } from '@/components/shop/newsletter-signup';
import { getMenu, getPolicyPath, getSellerInfo } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import { localizedPath } from '@/lib/seo/paths';
import type { MenuItem } from '@/server/modules/content';

/**
 * Storefront footer (§8.2): footer and legal menus (admin → Navigation) and the legal seller
 * information required on Vietnamese e-commerce sites (§1.5), read from settings.
 */
export async function SiteFooter() {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return (
    <footer className="border-line-200 bg-sand-100 mt-(--spacing-section) border-t lg:mt-(--spacing-section-lg)">
      <div className="container-content flex flex-col gap-10 py-12">
        {/* M3 wave 2: newsletter sign-up (double opt-in). */}
        <section
          aria-labelledby="footer-newsletter"
          className="border-line-200 grid gap-6 border-b pb-10 md:grid-cols-[1fr_1.2fr] md:gap-10"
        >
          <div className="flex flex-col gap-2">
            <h2 id="footer-newsletter" className="font-display text-h3">
              {t('footer.newsletter.title')}
            </h2>
            <p className="text-small text-taupe-600">{t('footer.newsletter.intro')}</p>
          </div>
          <Suspense fallback={null}>
            <FooterNewsletter />
          </Suspense>
        </section>
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex flex-col gap-2">
            <p className="font-display text-h3">{t('metadata.siteName')}</p>
            <p className="text-small text-taupe-600">{t('footer.tagline')}</p>
          </div>
          <Suspense fallback={null}>
            <FooterMenus />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <SellerInformation />
        </Suspense>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="text-small text-taupe-600">
            {t('footer.copyright', { siteName: t('metadata.siteName') })}
          </p>
          {/* M3 privacy: re-open cookie preferences; privacy request form for guests. */}
          <div className="flex flex-wrap items-center gap-x-6">
            <CookieSettingsButton className="text-small hover:text-gold-700 inline-flex min-h-11 items-center text-taupe-600 underline-offset-4 hover:underline md:min-h-9" />
            <Link
              href={localizedPath(locale as Locale, '/privacy-request') as Route}
              className="text-small hover:text-gold-700 inline-flex min-h-11 items-center text-taupe-600 underline-offset-4 hover:underline md:min-h-9"
            >
              {t('footer.privacyRequest')}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

async function FooterNewsletter() {
  await connection();
  const locale = (await getLocale()) as Locale;
  const privacyHref = await getPolicyPath('privacy', locale);
  return <NewsletterSignup source="footer" privacyHref={privacyHref} layout="inline" />;
}

function MenuLinks({ items, label }: { items: MenuItem[]; label: string }) {
  if (items.length === 0) return <div />;
  return (
    <nav aria-label={label}>
      <p className="eyebrow mb-3 text-taupe-600">{label}</p>
      <ul className="flex flex-col">
        {items.map((item) => {
          const external = /^https?:\/\//.test(item.href);
          const className =
            'text-small hover:text-gold-700 inline-flex min-h-11 items-center md:min-h-9';
          return (
            <li key={item.id}>
              {external ? (
                <a href={item.href} className={className} target="_blank" rel="noopener noreferrer">
                  {item.label}
                </a>
              ) : (
                <Link href={item.href as Route} className={className}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

async function FooterMenus() {
  await connection();
  const locale = (await getLocale()) as Locale;
  const [footer, legal, t] = await Promise.all([
    getMenu('footer', locale),
    getMenu('legal', locale),
    getTranslations({ locale, namespace: 'footer' }),
  ]);
  return (
    <>
      <MenuLinks items={footer} label={t('menuNav')} />
      <MenuLinks items={legal} label={t('legalNav')} />
    </>
  );
}

async function SellerInformation() {
  await connection();
  const locale = (await getLocale()) as Locale;
  const [seller, t] = await Promise.all([
    getSellerInfo(),
    getTranslations({ locale, namespace: 'footer.seller' }),
  ]);
  const lines = [
    seller.companyName,
    seller.businessRegistration,
    seller.taxCode && t('taxCode', { value: seller.taxCode }),
    seller.address && t('address', { value: seller.address }),
    seller.legalRepresentative && t('representative', { value: seller.legalRepresentative }),
    seller.phone && t('phone', { value: seller.phone }),
    seller.email && t('email', { value: seller.email }),
  ].filter(Boolean);
  if (lines.length === 0 && !seller.moitNotificationUrl) return null;
  return (
    <section
      aria-label={t('title')}
      className="border-line-200 flex flex-col gap-6 border-t pt-6 md:flex-row md:items-start md:justify-between"
    >
      <address className="text-small flex flex-col gap-1 text-taupe-600 not-italic">
        {lines.map((line) => (
          <span key={line as string}>{line}</span>
        ))}
      </address>
      {/* E-commerce Law 122/2025: notified-website badge, hidden until the record URL is set. */}
      {seller.moitNotificationUrl && (
        <a
          href={seller.moitNotificationUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="moit-badge"
          className="inline-flex shrink-0 items-center self-start"
        >
          {seller.moitBadgeImageUrl ? (
            // External official badge image (online.gov.vn), fixed size: no layout shift.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seller.moitBadgeImageUrl}
              alt={t('moitBadge')}
              width={150}
              height={57}
              loading="lazy"
              className="h-14 w-auto"
            />
          ) : (
            <span className="border-line-200 text-small inline-flex min-h-11 items-center border px-3 text-taupe-600">
              {t('moitBadge')}
            </span>
          )}
        </a>
      )}
    </section>
  );
}
