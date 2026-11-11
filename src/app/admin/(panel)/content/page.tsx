import Link from 'next/link';
import type { Route } from 'next';

import { PageHeader, requireContentAdmin } from './_shared';

const SECTIONS = ['banners', 'pages', 'posts', 'topics', 'navigation', 'redirects'] as const;

/** Content overview (§5.2 `/admin/content/*`). */
export default async function ContentOverviewPage() {
  const t = await requireContentAdmin();
  return (
    <section>
      <PageHeader title={t('title')} description={t('description')} />
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((section) => (
          <li key={section}>
            <Link
              href={`/admin/content/${section}` as Route}
              className="border-line-200 hover:border-ink-950 flex h-full flex-col gap-2 border p-6"
            >
              <span className="text-h3">{t(`sections.${section}.title`)}</span>
              <span className="text-small text-taupe-600">
                {t(`sections.${section}.description`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
