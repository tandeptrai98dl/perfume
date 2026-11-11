'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { searchOrderVariantsAction } from '@/actions/admin/manual-orders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ManualQuoteLine, OrderableVariant } from '@/server/modules/checkout';

import { useOrderFormat } from './format';
import { MAX_LINE_QUANTITY, MAX_LINES, type PickedLine } from './manual-order-types';

/*
 * Variant picker of the manual order (§11.2): search sellable variants (decants are never
 * offered, ADR-0015) with live availability, then set quantities. Prices shown come from the
 * server summary; the order is priced again when it is placed.
 */
export function ManualOrderItems({
  lines,
  onChange,
  quoteLines,
  lineErrors,
  error,
}: {
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  quoteLines: Map<string, ManualQuoteLine>;
  lineErrors: Record<string, string>;
  error: string | null;
}) {
  const t = useTranslations('admin.orders.new.items');
  const format = useOrderFormat();
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrderableVariant[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      const result = await searchOrderVariantsAction({ q });
      if (result.ok) {
        setResults(result.data);
        setSearched(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const label = (line: Pick<PickedLine, 'variantType' | 'sizeMl'>) =>
    t(`variantType.${line.variantType}`, { size: line.sizeMl });

  function add(variant: OrderableVariant) {
    const existing = lines.find((line) => line.variantId === variant.variantId);
    if (existing) {
      onChange(
        lines.map((line) =>
          line.variantId === variant.variantId
            ? { ...line, quantity: Math.min(line.quantity + 1, MAX_LINE_QUANTITY) }
            : line,
        ),
      );
    } else if (lines.length < MAX_LINES) {
      onChange([...lines, { ...variant, quantity: 1 }]);
    }
    setQuery('');
    setResults([]);
    setSearched(false);
  }

  function setQuantity(variantId: string, quantity: number) {
    const next = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.trunc(quantity) || 1));
    onChange(
      lines.map((line) => (line.variantId === variantId ? { ...line, quantity: next } : line)),
    );
  }

  const shown = query.trim() ? results : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-xl flex-col gap-2">
        <label htmlFor={`${id}-search`} className="text-small font-medium">
          {t('search')}
        </label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
          autoComplete="off"
          aria-describedby={`${id}-search-hint`}
        />
        <p id={`${id}-search-hint`} className="text-small text-taupe-600">
          {t('searchHint')}
        </p>
        {shown.length > 0 && (
          <ul className="border-line-200 flex flex-col border" aria-label={t('results')}>
            {shown.map((variant) => {
              const name = `${variant.productName} ${label(variant)}`;
              return (
                <li key={variant.variantId} className="border-line-200 border-b last:border-b-0">
                  <button
                    type="button"
                    className="text-small hover:bg-sand-100 flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={variant.available <= 0}
                    aria-label={t('add', { name })}
                    onClick={() => add(variant)}
                  >
                    <Plus aria-hidden className="size-4 shrink-0" />
                    <span className="font-medium">{variant.productName}</span>
                    <span>{label(variant)}</span>
                    <span className="text-taupe-600">{variant.brandName}</span>
                    <span className="font-mono text-taupe-600">{variant.sku}</span>
                    <span className="ml-auto tabular-nums">{format.vnd(variant.unitPrice)}</span>
                    <span
                      className={
                        variant.available > 0 ? 'text-taupe-600 tabular-nums' : 'text-danger'
                      }
                    >
                      {variant.available > 0
                        ? t('available', { count: variant.available })
                        : t('outOfStock')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {searched && query.trim() && shown.length === 0 && (
          <p className="text-small text-taupe-600" aria-live="polite">
            {t('noResults')}
          </p>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="text-small text-taupe-600">{t('empty')}</p>
      ) : (
        <table className="text-small w-full border-collapse">
          <caption className="sr-only">{t('caption')}</caption>
          <thead>
            <tr className="border-line-200 border-b text-left">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('product')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('quantity')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t('lineTotal')}
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const quote = quoteLines.get(line.variantId);
              const issue = lineErrors[line.variantId] ?? quote?.issue ?? null;
              const name = `${line.productName} ${label(line)}`;
              const available = quote?.available ?? line.available;
              return (
                <tr
                  key={line.variantId}
                  className="border-line-200 border-b align-top"
                  data-testid="manual-order-line"
                >
                  <td className="py-3 pr-3">
                    <p className="font-medium">{line.productName}</p>
                    <p className="text-taupe-600">
                      {label(line)} · {line.brandName} ·{' '}
                      <span className="font-mono">{line.sku}</span>
                    </p>
                    <p className="text-taupe-600 tabular-nums">
                      {quote ? format.vnd(quote.unitPrice) : null}
                      {quote ? ' · ' : null}
                      {t('available', { count: available })}
                    </p>
                    {issue && (
                      <p className="text-danger" role="alert">
                        {t(`issue.${issue as 'itemUnavailable'}`)}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_LINE_QUANTITY}
                      step={1}
                      value={line.quantity}
                      aria-label={t('quantityOf', { name })}
                      aria-invalid={issue ? true : undefined}
                      onChange={(event) => setQuantity(line.variantId, Number(event.target.value))}
                      className="w-20 tabular-nums"
                    />
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {quote ? format.vnd(quote.lineTotal) : '—'}
                    {quote && quote.discount > 0 && (
                      <p className="text-taupe-600">−{format.vnd(quote.discount)}</p>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('remove', { name })}
                      onClick={() => onChange(lines.filter((l) => l.variantId !== line.variantId))}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && (
        <p className="text-small text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
