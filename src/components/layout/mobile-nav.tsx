'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useRef, useState } from 'react';

export type MobileNavItem = {
  href: '/perfumes' | '/brands' | '/journal' | '/search' | '/account';
  key: 'perfumes' | 'brands' | 'journal' | 'search' | 'account';
};

const loadPanel = () => import('./mobile-nav-panel');
const MobileNavPanel = lazy(loadPanel);
/** Starts downloading the drawer on intent (touch, hover, focus) so opening feels instant. */
const preload = () => void loadPanel();

/**
 * Primary navigation below 768px (§8.2 MobileNav). The drawer (Radix Dialog) loads on first
 * use, outside the first-load JavaScript (§14.1); the trigger is a plain button.
 */
export function MobileNav({ items }: { items: readonly MobileNavItem[] }) {
  const t = useTranslations('navigation');
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (items.length === 0) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('openMenu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setUsed(true);
          setOpen(true);
        }}
        onPointerEnter={preload}
        onTouchStart={preload}
        onFocus={preload}
        className="hover:bg-sand-100 inline-flex size-11 items-center justify-center md:hidden [&_svg]:size-5"
      >
        <Menu aria-hidden />
      </button>
      {used && (
        <Suspense fallback={null}>
          <MobileNavPanel
            items={items}
            open={open}
            onOpenChange={setOpen}
            triggerRef={triggerRef}
          />
        </Suspense>
      )}
    </>
  );
}
