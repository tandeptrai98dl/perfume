import { useTranslations } from 'next-intl';

// Temporary home page; the editorial home is built in M1.
export default function HomePage() {
  const t = useTranslations('home');
  return (
    <section className="container-content flex flex-col items-center gap-6 py-(--spacing-section) text-center lg:py-(--spacing-section-lg)">
      <p className="eyebrow text-gold-700">{t('eyebrow')}</p>
      <h1 className="text-display-xl max-w-3xl">{t('title')}</h1>
      <p className="text-body-lg max-w-xl text-taupe-600">{t('subtitle')}</p>
    </section>
  );
}
