import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { StockRow } from '@/server/modules/inventory';

import { StockAdjustDialog } from './stock-adjust-dialog';

/** LowStockList (§8.4): active variants at or below their threshold; reusable on the dashboard. */
export function LowStockList({ rows }: { rows: StockRow[] }) {
  const t = useTranslations('admin.inventory');
  return (
    <section
      aria-labelledby="low-stock-title"
      className="border-line-200 flex flex-col gap-3 border p-4"
    >
      <h2 id="low-stock-title" className="text-h3 flex items-center gap-2">
        <AlertTriangle aria-hidden className="text-warning size-5" />
        {t('lowStockTitle')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-small text-taupe-600">{t('lowStockEmpty')}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.variantId}
              className="border-line-200 flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0"
            >
              <span className="text-small min-w-0 flex-1">
                <span className="font-medium">{row.productName}</span>{' '}
                <span className="font-mono text-taupe-600">{row.sku}</span>
              </span>
              <span className="text-small tabular-nums">
                {t('columns.available')}: <strong>{row.available}</strong> / {row.lowStockThreshold}
              </span>
              <StockAdjustDialog
                target={row}
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('adjust.openFor', { sku: row.sku })}
                  >
                    {t('adjust.open')}
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
