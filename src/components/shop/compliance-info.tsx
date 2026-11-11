import { useTranslations } from 'next-intl';

import type { ProductDetail } from '@/server/modules/catalog';

/** Cosmetics labelling information from structured fields (§1.5, §10.2). */
export function ComplianceInfo({
  compliance,
  countryName,
}: {
  compliance: ProductDetail['compliance'];
  /** Localized name of `countryOfOrigin` (ISO code), resolved by the caller. */
  countryName: string | null;
}) {
  const t = useTranslations('product.compliance');
  const rows: Array<[string, string | null]> = [
    [t('countryOfOrigin'), countryName],
    [t('responsibleImporter'), compliance.responsibleImporter],
    [t('cosmeticNotificationNo'), compliance.cosmeticNotificationNo],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-small text-taupe-600">{label}</dt>
            <dd>{value || t('pending')}</dd>
          </div>
        ))}
      </dl>
      {compliance.ingredients && (
        <div className="flex flex-col gap-1">
          <p className="text-small text-taupe-600">{t('ingredients')}</p>
          <p className="text-small whitespace-pre-line">{compliance.ingredients}</p>
        </div>
      )}
      {compliance.warnings && (
        <div className="flex flex-col gap-1">
          <p className="text-small text-taupe-600">{t('warnings')}</p>
          <p className="text-small whitespace-pre-line">{compliance.warnings}</p>
        </div>
      )}
    </div>
  );
}
