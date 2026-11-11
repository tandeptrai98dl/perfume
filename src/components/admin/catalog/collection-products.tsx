'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, useTransition } from 'react';

import { setCollectionProductsAction } from '@/actions/admin/catalog';
import { searchProductsAction, type ProductOption } from '@/actions/admin/products';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useActionFeedback } from '../form/action-feedback';
import { SortableList } from '../sortable-list';
import { StatusBadge } from '../status-badge';

type Item = {
  id: string;
  name: string;
  brandName: string;
  status: 'draft' | 'active' | 'archived';
};

/** Manual product order of a collection (§11.2): search to add, drag or buttons to order. */
export function CollectionProducts({
  collectionId,
  initial,
}: {
  collectionId: string;
  initial: Item[];
}) {
  const t = useTranslations('admin.collections.products');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const id = useId();
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductOption[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [saving, startSaving] = useTransition();
  const dirty = items.map((i) => i.id).join() !== initial.map((i) => i.id).join();

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      const result = await searchProductsAction({ q });
      if (result.ok) setResults(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const chosen = new Set(items.map((item) => item.id));
  const shown = query.trim() ? results.filter((r) => !chosen.has(r.id)) : [];

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${id}-title`} className="text-h3">
          {t('title')}
        </h2>
        <p className="text-small text-taupe-600">{t('hint')}</p>
      </div>
      <div className="flex max-w-lg flex-col gap-2">
        <label htmlFor={`${id}-search`} className="text-small font-medium">
          {t('search')}
        </label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {shown.length > 0 && (
          <ul className="border-line-200 flex flex-col border">
            {shown.map((product) => (
              <li
                key={product.id}
                className="border-line-200 flex items-center gap-2 border-b p-2 last:border-b-0"
              >
                <span className="text-small flex-1">
                  {product.name} <span className="text-taupe-600">· {product.brandName}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setItems([...items, product as Item]);
                    setAnnouncement(t('moved', { name: product.name, position: items.length + 1 }));
                  }}
                >
                  <Plus aria-hidden />
                  {t('add')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && shown.length === 0 && (
          <p className="text-small text-taupe-600">{t('noResults')}</p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-small text-taupe-600">{t('empty')}</p>
      ) : (
        <SortableList
          items={items}
          getKey={(item) => item.id}
          onChange={setItems}
          onMoved={(item, position) => setAnnouncement(t('moved', { name: item.name, position }))}
          labels={(item) => ({
            up: t('moveUp', { name: item.name }),
            down: t('moveDown', { name: item.name }),
            remove: t('remove', { name: item.name }),
          })}
          renderItem={(item, index) => (
            <span className="text-small flex flex-wrap items-center gap-2">
              <span className="text-taupe-600 tabular-nums">{index + 1}.</span>
              <span className="font-medium">{item.name}</span>
              <span className="text-taupe-600">{item.brandName}</span>
              <StatusBadge status={item.status} />
            </span>
          )}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          loading={saving}
          disabled={!dirty}
          onClick={() =>
            startSaving(async () => {
              const result = await setCollectionProductsAction({
                collectionId,
                productIds: items.map((item) => item.id),
              });
              if (!result.ok) {
                feedback.fail(result);
                return;
              }
              feedback.success(t('saved'));
            })
          }
        >
          {t('save')}
        </Button>
        {dirty && (
          <span className="text-small text-taupe-600" role="status">
            {tForm('unsaved')}
          </span>
        )}
      </div>
    </section>
  );
}
