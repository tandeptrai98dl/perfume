import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <main
      id="main-content"
      className="container-content flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center"
    >
      <h1 className="text-h1">{t('title')}</h1>
      <p className="text-taupe-600">{t('description')}</p>
      <Button asChild variant="secondary">
        <Link href="/">{t('backHome')}</Link>
      </Button>
    </main>
  );
}
