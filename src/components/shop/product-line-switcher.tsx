import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ProductLineSibling } from '@/server/modules/catalog';

/** Other concentrations of the same scent (ADR-0004). Hidden when the line has one product. */
export function ProductLineSwitcher({ siblings }: { siblings: ProductLineSibling[] }) {
  const t = useTranslations();
  if (siblings.length < 2) return null;
  return (
    <nav aria-label={t('product.productLineLabel')} className="flex flex-col gap-2">
      <p className="eyebrow text-taupe-600">{t('product.profile.concentration')}</p>
      <ul className="flex flex-wrap gap-2">
        {siblings.map((sibling) => (
          <li key={sibling.id}>
            <Link
              href={{ pathname: '/products/[slug]', params: { slug: sibling.slug } }}
              aria-current={sibling.isCurrent ? 'page' : undefined}
              className={cn(
                'text-small inline-flex min-h-11 items-center border px-4',
                sibling.isCurrent
                  ? 'border-ink-950 bg-ink-950 text-ivory-50'
                  : 'border-line-200 hover:border-ink-950',
              )}
            >
              {t(`catalog.concentrationShort.${sibling.concentration}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
