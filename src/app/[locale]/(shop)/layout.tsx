import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Suspense } from 'react';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { AnnouncementBar } from '@/components/shop/announcement-bar';
import { MiniCartSheet } from '@/components/shop/mini-cart-sheet';

import { CartCount } from './_lib/cart-count';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <AnnouncementBar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
      {/* Cart (M2): header badge count (per request) and the mini-cart drawer. */}
      <Suspense fallback={null}>
        <CartCount />
      </Suspense>
      <MiniCartSheet />
    </NuqsAdapter>
  );
}
