import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Route } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getMenu, getSellerInfo } from '@/data/content';
import type { Locale } from '@/i18n/routing';
import type { MenuItem } from '@/server/modules/content';

/**
 * Storefront footer (§8.2): footer and legal menus (admin → Navigation) and the legal seller
 * information required on Vietnamese e-commerce sites (§1.5), read from settings.
 */
export async function SiteFooter() {
  const t = await getTranslations();
  return (
    <footer className="border-line-200 bg-sand-100 mt-(--spacing-section) border-t lg:mt-(--spacing-section-lg)">
      <div className="container-content flex flex-col gap-10 py-12">
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
        <p className="text-small text-taupe-600">
          {t('footer.copyright', { siteName: t('metadata.siteName') })}
        </p>
      </div>
    </footer>
  );
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
  if (lines.length === 0) return null;
  return (
    <section aria-label={t('title')} className="border-line-200 border-t pt-6">
      <address className="text-small flex flex-col gap-1 text-taupe-600 not-italic">
        {lines.map((line) => (
          <span key={line as string}>{line}</span>
        ))}
      </address>
    </section>
  );
}
