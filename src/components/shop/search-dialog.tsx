'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Price } from '@/components/ui/price';
import { Spinner } from '@/components/ui/spinner';
import { Link, useRouter } from '@/i18n/navigation';
import type { SearchSuggestions } from '@/server/modules/catalog';

import { ProductImage } from './product-image';

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

type FetchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; data: SearchSuggestions }
  | { status: 'error'; query: string };

/**
 * Header search (§8.3): Ctrl/⌘+K opens a dialog with 6 product and 3 brand suggestions after a
 * 200 ms debounce; Enter shows all results. Without JavaScript the trigger links to /search.
 */
export function SearchDialog({ triggerClassName }: { triggerClassName?: string }) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const trimmed = query.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ status: 'loading', query: trimmed });
      try {
        const params = new URLSearchParams({ locale, q: trimmed });
        const response = await fetch(`/api/search/suggestions?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as SearchSuggestions;
        setState({ status: 'done', query: trimmed, data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: 'error', query: trimmed });
        void error;
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, locale]);

  const go = (href: Parameters<typeof router.push>[0]) => {
    setOpen(false);
    router.push(href);
  };
  const showAll = () => go({ pathname: '/search', query: { q: trimmed } });

  const data = state.status === 'done' && state.query === trimmed ? state.data : null;
  const loading = trimmed.length >= MIN_QUERY_LENGTH && (!data || state.status === 'loading');
  const empty = data && data.products.length === 0 && data.brands.length === 0;

  return (
    <>
      <Link
        href="/search"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        aria-label={t('dialog.open')}
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        className={triggerClassName}
      >
        <Search aria-hidden />
      </Link>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-4 max-w-2xl translate-y-0 gap-0 p-0 md:top-24">
          <DialogTitle className="sr-only">{t('dialog.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.hint')}</DialogDescription>
          <CommandPrimitive shouldFilter={false} label={t('dialog.title')} loop>
            <div className="border-line-200 flex items-center gap-3 border-b px-4 pr-14">
              <Search aria-hidden className="size-5 shrink-0 text-taupe-600" />
              <CommandPrimitive.Input
                value={query}
                onValueChange={setQuery}
                placeholder={t('placeholder')}
                aria-label={t('label')}
                className="h-14 w-full bg-transparent outline-none placeholder:text-taupe-600"
              />
              {loading && <Spinner />}
            </div>
            <CommandPrimitive.List className="max-h-[60dvh] overflow-y-auto p-2">
              {trimmed.length >= MIN_QUERY_LENGTH && (
                <CommandPrimitive.Item
                  value="__all__"
                  onSelect={showAll}
                  className="data-[selected=true]:bg-sand-100 text-gold-700 flex min-h-11 cursor-pointer items-center px-3"
                >
                  {t('dialog.seeAll', { query: trimmed })}
                </CommandPrimitive.Item>
              )}
              {state.status === 'error' && state.query === trimmed && (
                <p role="alert" className="text-small text-danger px-3 py-4">
                  {t('dialog.error')}
                </p>
              )}
              {empty && <p className="text-small px-3 py-4 text-taupe-600">{t('dialog.empty')}</p>}
              {data && data.products.length > 0 && (
                <CommandPrimitive.Group
                  heading={t('dialog.products')}
                  className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-taupe-600"
                >
                  {data.products.map((product) => (
                    <CommandPrimitive.Item
                      key={product.id}
                      value={`product-${product.id}`}
                      onSelect={() =>
                        go({ pathname: '/products/[slug]', params: { slug: product.slug } })
                      }
                      className="data-[selected=true]:bg-sand-100 flex cursor-pointer items-center gap-3 px-3 py-2"
                    >
                      <div className="w-12 shrink-0">
                        <ProductImage image={product.images[0]} alt="" sizes="48px" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="eyebrow text-taupe-600">{product.brand.name}</span>
                        <span className="truncate">{product.name}</span>
                      </div>
                      <Price
                        amount={product.fromPrice}
                        from={product.hasPriceRange}
                        className="text-small shrink-0"
                      />
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              )}
              {data && data.brands.length > 0 && (
                <CommandPrimitive.Group
                  heading={t('dialog.brands')}
                  className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-taupe-600"
                >
                  {data.brands.map((brand) => (
                    <CommandPrimitive.Item
                      key={brand.id}
                      value={`brand-${brand.id}`}
                      onSelect={() =>
                        go({ pathname: '/brands/[slug]', params: { slug: brand.slug } })
                      }
                      className="data-[selected=true]:bg-sand-100 flex min-h-11 cursor-pointer items-center px-3"
                    >
                      {brand.name}
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              )}
            </CommandPrimitive.List>
            <p aria-live="polite" className="sr-only">
              {loading ? t('dialog.loading') : ''}
            </p>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </>
  );
}
