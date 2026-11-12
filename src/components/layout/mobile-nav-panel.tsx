'use client';

import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';

import type { MobileNavItem } from './mobile-nav';

/** The mobile menu drawer, loaded on first opening by `MobileNav` (§14.1). */
export default function MobileNavPanel({
  items,
  open,
  onOpenChange,
  triggerRef,
}: {
  items: readonly MobileNavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focus goes back to the menu button on close (the button is not a Radix trigger). */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations('navigation');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">{t('mobileNav')}</SheetTitle>
        <nav aria-label={t('mobileNav')} className="mt-10">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.key} className="border-line-200 border-b">
                <Link
                  href={item.href}
                  onClick={() => onOpenChange(false)}
                  className="font-display text-h2 flex min-h-14 items-center"
                >
                  {t(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
