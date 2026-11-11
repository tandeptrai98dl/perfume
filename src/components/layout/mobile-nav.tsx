'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';

export type MobileNavItem = {
  href: '/perfumes' | '/brands' | '/journal' | '/search' | '/account';
  key: 'perfumes' | 'brands' | 'journal' | 'search' | 'account';
};

/** Primary navigation below 768px (§8.2 MobileNav). */
export function MobileNav({ items }: { items: readonly MobileNavItem[] }) {
  const t = useTranslations('navigation');
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t('openMenu')}
        className="hover:bg-sand-100 inline-flex size-11 items-center justify-center md:hidden [&_svg]:size-5"
      >
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="left">
        <SheetTitle className="sr-only">{t('mobileNav')}</SheetTitle>
        <nav aria-label={t('mobileNav')} className="mt-10">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.key} className="border-line-200 border-b">
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
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
