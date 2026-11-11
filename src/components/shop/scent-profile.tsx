import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { ProductDetail } from '@/server/modules/catalog';

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex gap-1">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={step <= value ? 'bg-gold-700 h-1 w-6' : 'bg-line-200 h-1 w-6'}
          />
        ))}
      </span>
      <span className="text-small text-taupe-600">{label}</span>
    </div>
  );
}

/** Longevity, sillage, seasons, occasions, families (§8.3 ScentProfile). */
export function ScentProfile({ product }: { product: ProductDetail }) {
  const t = useTranslations();
  const known = (group: 'season' | 'occasion', value: string) =>
    t.has(`catalog.${group}.${value}` as never) ? t(`catalog.${group}.${value}` as never) : value;

  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  rows.push({
    label: t('product.profile.concentration'),
    value: t(`catalog.concentration.${product.concentration}`),
  });
  rows.push({ label: t('product.profile.gender'), value: t(`catalog.gender.${product.gender}`) });
  if (product.families.length > 0) {
    rows.push({
      label: t('product.profile.families'),
      value: (
        <ul className="flex flex-wrap gap-x-3">
          {product.families.map((family) => (
            <li key={family.id}>
              <Link
                href={{ pathname: '/scent-families/[slug]', params: { slug: family.slug } }}
                className="text-gold-700 underline-offset-4 hover:underline"
              >
                {family.name}
              </Link>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (product.longevity) {
    const value = t('product.profile.scale', { value: product.longevity });
    rows.push({
      label: t('product.profile.longevity'),
      value: <Meter value={product.longevity} label={value} />,
    });
  }
  if (product.sillage) {
    const value = t('product.profile.scale', { value: product.sillage });
    rows.push({
      label: t('product.profile.sillage'),
      value: <Meter value={product.sillage} label={value} />,
    });
  }
  if (product.seasons.length > 0) {
    rows.push({
      label: t('product.profile.seasons'),
      value: product.seasons.map((s) => known('season', s)).join(', '),
    });
  }
  if (product.occasions.length > 0) {
    rows.push({
      label: t('product.profile.occasions'),
      value: product.occasions.map((o) => known('occasion', o)).join(', '),
    });
  }
  if (product.releaseYear)
    rows.push({ label: t('product.profile.releaseYear'), value: product.releaseYear });
  if (product.perfumer)
    rows.push({ label: t('product.profile.perfumer'), value: product.perfumer });

  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-small text-taupe-600">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
