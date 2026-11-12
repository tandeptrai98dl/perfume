'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

import { usePathname } from '@/i18n/navigation';

import { useMiniCart } from './cart-store';

const MiniCartPanel = lazy(() => import('./mini-cart-panel'));

/**
 * Mini-cart drawer (§10.3: opens after adding). The drawer and its line items load on the
 * first opening, outside every page's first-load JavaScript (§14.1), and stay mounted after.
 */
export function MiniCartSheet() {
  const open = useMiniCart((state) => state.open);
  const setOpen = useMiniCart((state) => state.setOpen);
  const pathname = usePathname();
  const [used, setUsed] = useState(open);
  if (open && !used) setUsed(true);

  // Close after navigating (View cart, Checkout, product links) instead of on click, so the
  // link's own navigation is never cut short by unmounting the sheet.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <MiniCartPanel />
    </Suspense>
  );
}
