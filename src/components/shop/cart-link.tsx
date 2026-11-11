'use client';

import { ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { useMiniCart } from './cart-store';

/**
 * Header cart icon with a live count (§8.2). A plain link to the cart page (works without
 * JavaScript); the badge follows the mini-cart store, seeded by `CartCountSeed`.
 */
export function CartLink({ className }: { className?: string }) {
  const t = useTranslations('cart');
  const count = useMiniCart((state) => state.count) ?? 0;
  return (
    <Link
      href="/cart"
      className={cn('relative', className)}
      aria-label={t('headerLink', { count })}
      data-testid="header-cart"
    >
      <ShoppingBag aria-hidden />
      {count > 0 && (
        <span
          aria-hidden
          data-testid="header-cart-count"
          className="bg-ink-950 text-ivory-50 text-eyebrow absolute top-1 right-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1 leading-5 font-medium tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

/** Rendered by the shop layout's dynamic hole: pushes the server's cart count to the store. */
export function CartCountSeed({ count }: { count: number }) {
  const setCount = useMiniCart((state) => state.setCount);
  useEffect(() => {
    setCount(count);
  }, [count, setCount]);
  return null;
}
