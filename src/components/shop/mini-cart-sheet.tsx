'use client';

import { ShoppingBag } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { getCart } from '@/actions/cart';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, usePathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { CartView } from '@/server/modules/cart';

import { CartLineItem } from './cart-line-item';
import { useMiniCart } from './cart-store';
import { FreeShippingProgress } from './free-shipping-progress';

/**
 * Mini-cart drawer (§10.3: opens after adding). Open state lives in the mini-cart store; the
 * content is loaded from the server each time it opens and after every change.
 */
export function MiniCartSheet() {
  const t = useTranslations('cart');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const open = useMiniCart((state) => state.open);
  const setOpen = useMiniCart((state) => state.setOpen);
  const setCount = useMiniCart((state) => state.setCount);
  const [view, setView] = useState<CartView | null>(null);
  const pathname = usePathname();

  // Close after navigating (View cart, Checkout, product links) instead of on click, so the
  // link's own navigation is never cut short by unmounting the sheet.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void getCart({ locale }).then((result) => {
      if (!active || !result.ok) return;
      setView(result.data);
      setCount(result.data.itemCount);
    });
    return () => {
      active = false;
    };
  }, [open, locale, setCount]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="gap-6" data-testid="mini-cart">
        <SheetHeader>
          <SheetTitle>{t('mini.title')}</SheetTitle>
          <SheetDescription>
            {view ? t('mini.count', { count: view.itemCount }) : t('mini.loading')}
          </SheetDescription>
        </SheetHeader>

        {!view ? (
          <div className="flex flex-col gap-4" aria-hidden>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : view.lines.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag aria-hidden />}
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              <Button asChild variant="secondary">
                <Link href="/perfumes">{t('empty.action')}</Link>
              </Button>
            }
            className="py-8"
          />
        ) : (
          <>
            <FreeShippingProgress progress={view.freeShipping} />
            <ul aria-label={t('linesLabel')} className="border-line-200 border-t">
              {view.lines.map((line) => (
                <CartLineItem key={line.itemId} line={line} compact onView={setView} />
              ))}
            </ul>
            <div className="mt-auto flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-taupe-600">{t('summary.subtotal')}</span>
                <span className="text-h3 tabular-nums" data-testid="mini-cart-subtotal">
                  {format.number(view.subtotal, 'vnd')}
                </span>
              </div>
              <p className="text-small text-taupe-600">{t('summary.totalNote')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button asChild variant="secondary">
                  <Link href="/cart">{t('viewCart')}</Link>
                </Button>
                {view.canCheckout && (
                  <Button asChild>
                    <Link href="/checkout">{t('checkout')}</Link>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
