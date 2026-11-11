import { getTranslations } from 'next-intl/server';

/** Storefront footer (§8.2). Legal seller information and policies arrive with M1 content. */
export async function SiteFooter() {
  const t = await getTranslations();
  return (
    <footer className="border-line-200 bg-sand-100 mt-(--spacing-section) border-t lg:mt-(--spacing-section-lg)">
      <div className="container-content flex flex-col gap-2 py-12">
        <p className="font-display text-h3">{t('metadata.siteName')}</p>
        <p className="text-small text-taupe-600">{t('footer.tagline')}</p>
        <p className="text-small text-taupe-600">
          {t('footer.copyright', { siteName: t('metadata.siteName') })}
        </p>
      </div>
    </footer>
  );
}
