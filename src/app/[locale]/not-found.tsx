import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <main id="main">
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Link href="/">{t('backHome')}</Link>
    </main>
  );
}
