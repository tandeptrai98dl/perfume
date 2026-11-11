import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function AdminForbiddenPage() {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.forbidden' });
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl">{t('title')}</h1>
      <p>{t('description')}</p>
      <Link href="/admin" className="underline">
        {t('back')}
      </Link>
    </section>
  );
}
