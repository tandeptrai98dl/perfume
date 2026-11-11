import { useTranslations } from 'next-intl';

// Temporary home page; the editorial home is built in M1.
export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main id="main">
      <p>{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>
    </main>
  );
}
