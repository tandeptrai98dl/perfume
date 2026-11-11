'use client';

import { Menu } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { activeHref, type AdminNavSection } from './nav-items';

function NavList({
  sections,
  onNavigate,
}: {
  sections: AdminNavSection[];
  onNavigate?: () => void;
}) {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  const current = activeHref(pathname, sections);
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.labelKey} className="flex flex-col gap-1">
          <p className="eyebrow px-3 text-taupe-600" id={`nav-${section.labelKey}`}>
            {t(section.labelKey)}
          </p>
          <ul aria-labelledby={`nav-${section.labelKey}`} className="flex flex-col">
            {section.items.map((item) => {
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as Route}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'text-small flex min-h-10 items-center border-l-2 border-transparent px-3',
                      'hover:bg-sand-100 transition-colors duration-(--duration-hover)',
                      active && 'border-ink-950 bg-sand-100 font-medium',
                    )}
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Persistent sidebar from 1024 px; a sheet opened from the top bar below that. */
export function AdminSidebar({ sections }: { sections: AdminNavSection[] }) {
  const t = useTranslations('admin.nav');
  return (
    <nav
      aria-label={t('label')}
      className="border-line-200 sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r bg-white px-3 py-6 lg:block"
    >
      <NavList sections={sections} />
    </nav>
  );
}

export function AdminMobileNav({ sections }: { sections: AdminNavSection[] }) {
  const t = useTranslations('admin.nav');
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        aria-label={t('open')}
        aria-expanded={open}
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden />
      </IconButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-white" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('label')}</SheetTitle>
          </SheetHeader>
          <nav aria-label={t('label')}>
            <NavList sections={sections} onNavigate={() => setOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
