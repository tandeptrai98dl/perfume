'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';

const loadPanel = () => import('./search-panel');
const SearchPanel = lazy(loadPanel);
/** Starts downloading the dialog on intent (hover, focus, touch) so opening feels instant. */
const preload = () => void loadPanel();

/**
 * Header search (§8.3): Ctrl/⌘+K opens a dialog with 6 product and 3 brand suggestions after a
 * 200 ms debounce; Enter shows all results. Without JavaScript the trigger links to /search.
 * The dialog (cmdk, Radix Dialog) loads on first use, outside the first-load JS (§14.1).
 */
export function SearchDialog({ triggerClassName }: { triggerClassName?: string }) {
  const t = useTranslations('search');
  const [open, setOpen] = useState(false);
  // Stays mounted after the first opening (keeps the query and the close animation).
  const [used, setUsed] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const changeOpen = (next: boolean) => {
    if (next) setUsed(true);
    setOpen(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setUsed(true);
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Link
        ref={triggerRef}
        href="/search"
        onClick={(event) => {
          event.preventDefault();
          changeOpen(true);
        }}
        onPointerEnter={preload}
        onFocus={preload}
        onTouchStart={preload}
        aria-label={t('dialog.open')}
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        className={triggerClassName}
      >
        <Search aria-hidden />
      </Link>
      {used && (
        <Suspense fallback={null}>
          <SearchPanel open={open} onOpenChange={changeOpen} triggerRef={triggerRef} />
        </Suspense>
      )}
    </>
  );
}
